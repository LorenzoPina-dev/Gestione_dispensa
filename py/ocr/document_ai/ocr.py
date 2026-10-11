from __future__ import annotations

from typing import Protocol

import numpy as np

from ocr.document_ai.models import OCRResult
from ocr.domain.ocr_ports import LineReader


class OCRBackend(Protocol):
    def predict(self, image: np.ndarray) -> OCRResult: ...


class LineReaderBackend:
    """Adattatore per l'OcrEngine esistente; PaddleOCR/cloud possono implementare OCRBackend."""

    def __init__(self, reader: LineReader) -> None:
        self._reader = reader

    def predict(self, image: np.ndarray) -> OCRResult:
        lines = self._reader.read_lines(image)
        return OCRResult(
            text="\n".join(line.text for line in lines),
            confidence=float(np.mean([line.confidence for line in lines])) if lines else 0.0,
            lines=tuple(line.text for line in lines),
            raw=lines,
        )
