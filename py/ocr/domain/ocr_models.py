"""Modelli di dominio specifici dell'OCR (indipendenti dal runtime ML)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, eq=False)
class TextBox:
    """Box di testo rilevato. `points` e' (4, 2) float32 ordinato TL, TR, BR, BL,
    in coordinate dell'immagine passata al detector."""

    points: np.ndarray
    score: float

    @property
    def center_y(self) -> float:
        return float(self.points[:, 1].mean())

    @property
    def x_min(self) -> float:
        return float(self.points[:, 0].min())

    @property
    def x_max(self) -> float:
        return float(self.points[:, 0].max())

    @property
    def height(self) -> float:
        # Lunghezza del lato sinistro (TL -> BL): robusta a piccole rotazioni.
        return float(np.linalg.norm(self.points[3] - self.points[0]))


@dataclass(frozen=True)
class Recognition:
    text: str
    confidence: float  # 0..1


@dataclass(frozen=True)
class OcrLine:
    """Riga di scontrino: i box sulla stessa linea orizzontale uniti da sinistra a destra."""

    text: str
    confidence: float
    y_center: float
    x_min: float
    x_max: float
