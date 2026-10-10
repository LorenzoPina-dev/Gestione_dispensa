"""Porte OCR: l'applicazione dipende da queste, non da TFLite/CoreML."""
from __future__ import annotations

from typing import List, Protocol, Sequence

import numpy as np

from ocr.domain.ocr_models import OcrLine, Recognition, TextBox


class TextDetector(Protocol):
    def detect(self, image_bgr: np.ndarray) -> List[TextBox]: ...


class TextRecognizer(Protocol):
    def recognize(self, crops_bgr: Sequence[np.ndarray]) -> List[Recognition]: ...


class LineReader(Protocol):
    """Immagine -> righe di testo ordinate dall'alto verso il basso."""

    def read_lines(self, image_bgr: np.ndarray) -> List[OcrLine]: ...
