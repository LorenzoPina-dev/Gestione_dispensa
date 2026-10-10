"""Similarita' tra stringhe: distanza di Levenshtein (fuzzy matching).

Definizione (programmazione dinamica)
-------------------------------------
D(i, j) = distanza minima tra i primi i caratteri di a e i primi j di b:

    D(i, 0) = i                      D(0, j) = j
    D(i, j) = min( D(i-1, j)   + 1,                 # cancellazione
                   D(i,   j-1) + 1,                 # inserimento
                   D(i-1, j-1) + [a_i != b_j] )     # sostituzione (0 se uguali)

Si tiene solo la riga precedente: memoria O(min(|a|, |b|)) invece di O(|a|*|b|).

Similarita' normalizzata:  sim(a, b) = 1 - D(a, b) / max(|a|, |b|)   in [0, 1]

Ottimizzazione "bounded": se serve solo sapere se D <= k, si interrompe appena il minimo
della riga corrente supera k (le righe successive non possono diminuire il minimo).
Su centinaia di confronti per frame questo fa risparmiare la maggior parte del lavoro.
"""
from __future__ import annotations

import re
from typing import Optional

_WHITESPACE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """Minuscolo + spazi collassati: l'OCR varia spesso solo per case/spaziatura."""
    return _WHITESPACE.sub(" ", text.casefold()).strip()


def levenshtein_distance(a: str, b: str, max_distance: Optional[int] = None) -> int:
    """Distanza di edit. Con max_distance, se la distanza reale lo supera ritorna max_distance + 1."""
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a  # b e' la stringa piu' corta: la riga DP ha lunghezza len(b) + 1
    if not b:
        return len(a)
    if max_distance is not None and len(a) - len(b) > max_distance:
        return max_distance + 1  # la sola differenza di lunghezza supera il limite

    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        row_min = i
        for j, char_b in enumerate(b, start=1):
            cost = 0 if char_a == char_b else 1
            value = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            current.append(value)
            if value < row_min:
                row_min = value
        if max_distance is not None and row_min > max_distance:
            return max_distance + 1
        previous = current
    return previous[-1]


def similarity(a: str, b: str, min_ratio: float = 0.0) -> float:
    """Similarita' in [0, 1]. Se e' sotto `min_ratio` ritorna 0.0 (early exit, vedi docstring)."""
    if a == b:
        return 1.0
    longest = max(len(a), len(b))
    if longest == 0:
        return 1.0
    max_distance = int((1.0 - min_ratio) * longest)
    distance = levenshtein_distance(a, b, max_distance)
    if distance > max_distance:
        return 0.0
    return 1.0 - distance / longest
