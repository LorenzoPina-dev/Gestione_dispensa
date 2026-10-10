"""Consumer concreti della porta `FrameConsumer`."""
from __future__ import annotations

import logging
import os
from typing import Sequence

import cv2

from ocr.domain.models import Frame, ScanRegion
from ocr.domain.ports import FrameConsumer

log = logging.getLogger(__name__)


class SaveCropsConsumer:
    """Salva su disco 1 scontrino RADDRIZZATO ogni `every_n` frame accettati (debug / dataset).

    Salva l'immagine che vede l'OCR (`frame_N.png`); se l'enhancement e' attivo salva anche il
    patch grezzo (`frame_N_raw.png`) per verificare a occhio raddrizzamento e miglioramento."""

    def __init__(self, output_dir: str, every_n: int = 5) -> None:
        if every_n < 1:
            raise ValueError("every_n deve essere >= 1")
        os.makedirs(output_dir, exist_ok=True)
        self._output_dir = output_dir
        self._every_n = every_n
        self._accepted = 0

    def on_frame(self, frame: Frame, region: ScanRegion) -> None:
        self._accepted += 1
        if self._accepted % self._every_n != 0:
            return
        stem = os.path.join(self._output_dir, f"frame_{frame.index:06d}")
        cv2.imwrite(stem + ".png", region.ocr_image)
        if region.enhanced is not None:
            cv2.imwrite(stem + "_raw.png", region.patch)


class CompositeConsumer:
    """Inoltra lo stesso frame a piu' consumer (Composite pattern)."""

    def __init__(self, consumers: Sequence[FrameConsumer]) -> None:
        self._consumers = list(consumers)

    def on_frame(self, frame: Frame, region: ScanRegion) -> None:
        for consumer in self._consumers:
            consumer.on_frame(frame, region)
