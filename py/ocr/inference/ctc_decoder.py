"""Decoding CTC (Connectionist Temporal Classification) e charset.

CRNN produce, per ogni "time step" t (colonna orizzontale dell'immagine), una distribuzione
sulle classi: P(t, k). Il decoding greedy e':

    1) k*(t) = argmax_k P(t, k)               # classe piu' probabile per colonna
    2) collassa i ripetuti consecutivi         # "hh" -> "h"
    3) rimuovi i blank                         # il blank separa lettere doppie ("l-l" -> "ll")

Esempio: "--hh-e-ll-llo--"  ->  collassa: "-h-e-l-lo-"  -> rimuovi blank: "hello"
Confidenza della stringa = media di P(t, k*) sui time step che hanno emesso un carattere.
"""
from __future__ import annotations

import os
import string
from typing import List, Sequence

import numpy as np

from ocr.domain.ocr_models import Recognition

# Charset di default pensato per scontrini italiani. Se il tuo modello e' stato addestrato
# con un dizionario diverso, passa --charset con un file (un carattere per riga).
DEFAULT_CHARSET: str = string.digits + string.ascii_letters + " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" + "€°àèéìòùÀÈÉÌÒÙ"


def load_charset(path: str) -> str:
    """Carica un dizionario stile PaddleOCR: un carattere per riga (la riga ' ' e' lo spazio)."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Charset non trovato: {path}")
    chars: List[str] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\r\n")
            if line == "":
                continue
            chars.append(line[0] if len(line) == 1 else line)
    return "".join(chars)


def build_classes(charset: str, blank_first: bool = True) -> List[str]:
    """Lista delle classi dell'output. Il blank e' rappresentato dalla stringa vuota."""
    return ([""] + list(charset)) if blank_first else (list(charset) + [""])


def softmax(logits: np.ndarray, axis: int = -1) -> np.ndarray:
    """softmax(z)_k = exp(z_k - max z) / sum_j exp(z_j - max z)  (stabile numericamente)."""
    shifted = logits - logits.max(axis=axis, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=axis, keepdims=True)


def ctc_greedy_decode(probs: np.ndarray, classes: Sequence[str], blank_index: int) -> Recognition:
    """probs: (T, num_classes). Vedi docstring del modulo."""
    best = probs.argmax(axis=1)
    best_prob = probs.max(axis=1)

    chars: List[str] = []
    confidences: List[float] = []
    previous = -1
    for t, k in enumerate(best):
        if k != previous and k != blank_index:
            chars.append(classes[k])
            confidences.append(float(best_prob[t]))
        previous = k

    confidence = float(np.mean(confidences)) if confidences else 0.0
    return Recognition(text="".join(chars), confidence=confidence)
