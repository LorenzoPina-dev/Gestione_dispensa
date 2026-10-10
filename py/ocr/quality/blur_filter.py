"""Blur detection tramite Varianza del Laplaciano.

Matematica
----------
1) Scala di grigi (ITU-R BT.601):      Y = 0.299 R + 0.587 G + 0.114 B

2) Laplaciano discreto (derivata seconda, kernel a 4 vicini, ksize=1 in OpenCV):

        |  0  1  0 |
    K = |  1 -4  1 |        L(x, y) = I(x+1,y) + I(x-1,y) + I(x,y+1) + I(x,y-1) - 4 I(x,y)
        |  0  1  0 |

   La derivata seconda risponde ai cambi bruschi di intensita' (bordi). In un'immagine
   nitida i bordi dei caratteri sono netti: L assume valori molto positivi e molto
   negativi. In un'immagine sfocata i bordi sono "spalmati": L resta vicino a 0.

3) Score di nitidezza = Var(L) = E[L^2] - (E[L])^2
   Alta varianza => molti bordi netti => immagine a fuoco.
   Bassa varianza => bordi deboli => immagine sfocata o priva di dettagli.

Nota: se la ROI e' un foglio bianco senza testo, Var(L) e' bassa pur essendo a fuoco.
Per il nostro caso e' desiderabile: senza testo non c'e' nulla da fare OCR.
"""
from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from ocr.config import BlurFilterConfig
from ocr.domain.models import QualityResult


class LaplacianBlurFilter:
    """Implementa la porta `QualityFilter`."""

    def __init__(self, config: Optional[BlurFilterConfig] = None) -> None:
        self._config = config if config is not None else BlurFilterConfig()

    @property
    def threshold(self) -> float:
        return self._config.threshold

    def evaluate(self, image: np.ndarray) -> QualityResult:
        """Calcola lo score di nitidezza dell'immagine (BGR o grigio, uint8)."""
        if image is None or image.size == 0:
            # Frame vuoto: score 0 => sempre scartato dal chiamante.
            return QualityResult(score=0.0, threshold=self._config.threshold)

        gray = self._to_gray(image)
        gray = self._normalize_resolution(gray)

        # CV_64F: il Laplaciano produce valori negativi; con uint8 verrebbero saturati a 0
        # falsando la varianza. ksize=1 => kernel [[0,1,0],[1,-4,1],[0,1,0]].
        laplacian = cv2.Laplacian(gray, cv2.CV_64F, ksize=1)

        # meanStdDev e' ottimizzato in C++; Var = std^2.
        _, std = cv2.meanStdDev(laplacian)
        score = float(std[0][0] ** 2)
        return QualityResult(score=score, threshold=self._config.threshold)

    # --------------------------------------------------------------------- helpers
    @staticmethod
    def _to_gray(image: np.ndarray) -> np.ndarray:
        if image.ndim == 2:
            return image
        if image.shape[2] == 4:
            return cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    def _normalize_resolution(self, gray: np.ndarray) -> np.ndarray:
        """Ridimensiona a larghezza fissa: rende la soglia indipendente dalla risoluzione.

        INTER_AREA e' il filtro corretto per il downscaling (media sui pixel coperti,
        niente aliasing che gonfierebbe artificialmente la varianza).
        """
        target = self._config.normalize_width
        if target is None:
            return gray
        h, w = gray.shape[:2]
        if w == target:
            return gray
        scale = target / float(w)
        new_size = (target, max(1, int(round(h * scale))))
        interpolation = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
        return cv2.resize(gray, new_size, interpolation=interpolation)
