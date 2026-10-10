"""Modelli di dominio: strutture dati pure, indipendenti da UI e da runtime ML."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class Rect:
    """Rettangolo in pixel (origine in alto a sinistra)."""

    x: int
    y: int
    width: int
    height: int

    @property
    def x2(self) -> int:
        return self.x + self.width

    @property
    def y2(self) -> int:
        return self.y + self.height

    def crop(self, image: np.ndarray) -> np.ndarray:
        """Ritaglia la regione dall'immagine (view numpy, nessuna copia)."""
        return image[self.y : self.y2, self.x : self.x2]

    def corners(self) -> np.ndarray:
        """Angoli TL, TR, BR, BL come array (4, 2) float32."""
        return np.array(
            [[self.x, self.y], [self.x2, self.y], [self.x2, self.y2], [self.x, self.y2]],
            dtype=np.float32,
        )


@dataclass(frozen=True)
class Frame:
    """Un frame acquisito. `index` cresce monotonicamente dal frame 1."""

    index: int
    timestamp: float  # secondi, orologio monotono
    image: np.ndarray  # BGR uint8, shape (H, W, 3)


@dataclass(frozen=True, eq=False)
class ScanRegion:
    """Scontrino individuato nel frame.

    quad:  quadrilatero (4, 2) float32, ordine TL, TR, BR, BL, in coordinate del frame.
           Rettangolo regolare, eventualmente inclinato o in prospettiva: serve all'overlay.
    patch: immagine RADDRIZZATA dello scontrino (vista frontale, testo orizzontale), NON
           elaborata: ci lavora il filtro di nitidezza (soglia tarata sui pixel originali).
    enhanced: stesso patch dopo bilanciamento colore / correzione luce / contrasto, oppure
           None se l'enhancement e' disattivato. E' l'immagine da dare all'OCR (`ocr_image`).
    """

    quad: np.ndarray
    patch: np.ndarray
    enhanced: Optional[np.ndarray] = None

    @property
    def ocr_image(self) -> np.ndarray:
        """Immagine per l'OCR: quella migliorata se c'e', altrimenti il patch grezzo."""
        return self.enhanced if self.enhanced is not None else self.patch


@dataclass(frozen=True)
class QualityResult:
    """Esito di un controllo qualita': score >= threshold => frame accettato."""

    score: float
    threshold: float

    @property
    def passed(self) -> bool:
        return self.score >= self.threshold


@dataclass(frozen=True, eq=False)
class ScanStatus:
    """Snapshot dello stato della sessione, letto dalla UI per l'overlay."""

    frame_index: int = 0
    quality: Optional[QualityResult] = None
    accepted: int = 0
    rejected: int = 0
    quad: Optional[np.ndarray] = None  # quadrilatero dell'ultimo frame (None = carta non trovata)
