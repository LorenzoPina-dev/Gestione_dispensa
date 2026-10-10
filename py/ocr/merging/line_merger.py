"""Unione (stitching) delle righe lette da frame successivi in un unico scontrino.

Idea
----
L'utente fa scorrere la camera lungo lo scontrino: il frame N mostra alcune righe gia' viste
nel frame N-1 (sovrapposizione) piu' righe nuove. L'array accumulato contiene gia' tutto
cio' che e' stato letto fino a N-1, quindi confrontiamo il frame N con l'accumulato:

1) ANCORE: ogni coppia (riga i accumulata, riga j nuova) con similarita' Levenshtein alta
   vota per l'offset  d = i - j  (la riga j del frame corrisponde alla riga j + d dell'array).
   Offset corretto = molte coppie votano lo stesso d (le righe duplicate "1,00" o "TOTALE"
   votano offset diversi, ma nessuno raccoglie il consenso di quello giusto).

2) VERIFICA: per l'offset candidato si confrontano TUTTE le righe sovrapposte; si accetta
   se la frazione di righe simili (>= line_similarity) supera min_overlap_ratio. Tollera
   righe lette male o mancanti in uno dei due frame.

3) MERGE: righe del frame prima dell'array (d < 0) -> prepend; dopo la fine -> append;
   righe sovrapposte -> si tiene la versione gia' accumulata (duplicati scartati).

Se non si trova sovrapposizione affidabile il frame viene ignorato (NO_OVERLAP): meglio
perdere un frame che inserire righe nel punto sbagliato.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Sequence, Tuple

from ocr.merging.text_similarity import normalize_text, similarity


class MergeStatus(Enum):
    EMPTY = "empty"  # il frame non contiene righe
    INITIAL = "initial"  # primo frame: l'array era vuoto
    MERGED = "merged"  # aggiunte righe nuove (sopra e/o sotto)
    UNCHANGED = "unchanged"  # tutto gia' noto: solo duplicati
    NO_OVERLAP = "no_overlap"  # nessun allineamento affidabile: frame ignorato


@dataclass(frozen=True)
class MergeResult:
    lines: Tuple[str, ...]
    status: MergeStatus
    offset: Optional[int] = None  # indice nell'array della prima riga del frame
    added: int = 0


@dataclass(frozen=True)
class MergeConfig:
    line_similarity: float = 0.80  # due righe sono "la stessa" sopra questa soglia
    anchor_similarity: float = 0.85  # soglia piu' severa per le ancore che votano
    min_anchor_chars: int = 4  # righe troppo corte ("A", "1,00") sono ambigue come ancore
    min_overlap_ratio: float = 0.5  # frazione minima di righe sovrapposte che deve combaciare
    min_matched_lines: int = 2  # righe combacianti minime (ridotto se frame/array sono piccoli)
    max_candidates: int = 5  # offset candidati da verificare, in ordine di voti


class LineMerger:
    def __init__(self, config: MergeConfig = MergeConfig()) -> None:
        self._cfg = config

    def merge(self, accumulated: Sequence[str], new_lines: Sequence[str]) -> MergeResult:
        accumulated = list(accumulated)
        fresh = [line.strip() for line in new_lines if line and line.strip()]
        if not fresh:
            return MergeResult(tuple(accumulated), MergeStatus.EMPTY)
        if not accumulated:
            return MergeResult(tuple(fresh), MergeStatus.INITIAL, offset=0, added=len(fresh))

        norm_acc = [normalize_text(s) for s in accumulated]
        norm_new = [normalize_text(s) for s in fresh]

        offset = self._find_offset(norm_acc, norm_new)
        if offset is None:
            return MergeResult(tuple(accumulated), MergeStatus.NO_OVERLAP)

        # Righe del frame che cadono PRIMA dell'inizio dell'array (offset negativo)...
        prepend = fresh[: max(0, -offset)]
        # ...e DOPO la fine: la riga j del frame sta all'indice j + offset >= len(acc).
        tail_start = max(0, len(accumulated) - offset)
        append = fresh[tail_start:]

        merged = prepend + accumulated + append
        added = len(prepend) + len(append)
        status = MergeStatus.MERGED if added else MergeStatus.UNCHANGED
        return MergeResult(tuple(merged), status, offset=offset, added=added)

    # ------------------------------------------------------------------ alignment
    def _find_offset(self, acc: List[str], new: List[str]) -> Optional[int]:
        votes: Dict[int, float] = defaultdict(float)
        cfg = self._cfg

        for i, line_acc in enumerate(acc):
            if len(line_acc) < cfg.min_anchor_chars:
                continue
            for j, line_new in enumerate(new):
                if len(line_new) < cfg.min_anchor_chars:
                    continue
                score = similarity(line_acc, line_new, cfg.anchor_similarity)
                if score >= cfg.anchor_similarity:
                    votes[i - j] += score

        ranked = sorted(votes.items(), key=lambda kv: kv[1], reverse=True)[: cfg.max_candidates]
        for offset, _ in ranked:
            if self._verify(acc, new, offset):
                return offset
        return None

    def _verify(self, acc: List[str], new: List[str], offset: int) -> bool:
        cfg = self._cfg
        overlap = [j for j in range(len(new)) if 0 <= j + offset < len(acc)]
        if not overlap:
            return False
        matched = sum(
            1
            for j in overlap
            if similarity(acc[j + offset], new[j], cfg.line_similarity) >= cfg.line_similarity
        )
        required = max(1, min(cfg.min_matched_lines, len(new), len(acc)))
        return matched >= required and matched / len(overlap) >= cfg.min_overlap_ratio
