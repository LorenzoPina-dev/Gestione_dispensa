"""Aggregazione fuzzy delle righe OCR osservate in frame successivi."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ocr.merging.line_merger import LineMerger, MergeStatus
from ocr.merging.text_similarity import normalize_text, similarity


@dataclass(frozen=True)
class FuzzyReceiptConfig:
    similarity: float = 0.82
    min_observations: int = 1


@dataclass
class _Evidence:
    text: str
    confidence: float
    observations: int = 1
    first_frame: int = 0
    last_frame: int = 0


class FuzzyReceiptAccumulator:
    """Unisce righe sovrapposte e deduplica OCR rumoroso senza perdere righe isolate."""

    def __init__(self, config: FuzzyReceiptConfig = FuzzyReceiptConfig()) -> None:
        if not 0.0 < config.similarity <= 1.0:
            raise ValueError("similarity deve essere compresa tra 0 e 1")
        self._config = config
        self._line_merger = LineMerger()
        self._evidence: list[_Evidence] = []
        self._lines: list[str] = []

    def update(self, lines: Sequence[str], frame_index: int) -> None:
        fresh = [line.strip() for line in lines if line and line.strip()]
        if not fresh:
            return
        previous = list(self._lines)
        aligned = self._line_merger.merge(previous, fresh)
        if aligned.status != MergeStatus.NO_OVERLAP:
            self._lines = list(aligned.lines)
        else:
            self._merge_without_alignment(fresh)
        self._rebuild_evidence(fresh, frame_index)

    def _merge_without_alignment(self, fresh: list[str]) -> None:
        for line in fresh:
            match = self._best_match(line, self._lines)
            if match is None:
                self._lines.append(line)
            elif similarity(normalize_text(self._lines[match]), normalize_text(line), self._config.similarity) < 1.0:
                if len(line) > len(self._lines[match]):
                    self._lines[match] = line

    def _best_match(self, line: str, candidates: Sequence[str]) -> int | None:
        scores = [
            similarity(normalize_text(candidate), normalize_text(line), self._config.similarity)
            for candidate in candidates
        ]
        if not scores or max(scores) < self._config.similarity:
            return None
        return max(range(len(scores)), key=scores.__getitem__)

    def _rebuild_evidence(self, fresh: Sequence[str], frame_index: int) -> None:
        for line in fresh:
            index = self._best_match(line, [item.text for item in self._evidence])
            if index is None:
                self._evidence.append(_Evidence(line, 0.0, 1, frame_index, frame_index))
                continue
            item = self._evidence[index]
            item.confidence = max(item.confidence, 1.0)
            item.observations += 1
            item.last_frame = frame_index
            if len(line) > len(item.text):
                item.text = line

    def snapshot(self) -> list[str]:
        return list(self._lines)

    def evidence(self) -> list[dict[str, int | float | str]]:
        return [
            {
                "text": item.text,
                "observations": item.observations,
                "first_frame": item.first_frame,
                "last_frame": item.last_frame,
            }
            for item in self._evidence
            if item.observations >= self._config.min_observations
        ]
