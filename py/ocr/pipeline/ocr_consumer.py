"""Consumer che esegue l'OCR sui frame accettati e alimenta l'accumulatore."""
from __future__ import annotations

import logging
import time

from ocr.domain.models import Frame, ScanRegion
from ocr.domain.ocr_ports import LineReader
from ocr.merging.accumulator import ReceiptAccumulator

log = logging.getLogger(__name__)


class OcrFrameConsumer:
    """Implementa `FrameConsumer`. Gira sul thread "scan-worker", quindi la UI non e' bloccata."""

    def __init__(self, reader: LineReader, accumulator: ReceiptAccumulator) -> None:
        self._reader = reader
        self._accumulator = accumulator

    def on_frame(self, frame: Frame, region: ScanRegion) -> None:
        started = time.perf_counter()
        lines = self._reader.read_lines(region.ocr_image)
        result = self._accumulator.update([line.text for line in lines])
        log.debug(
            "frame %d: %d righe, merge=%s (+%d), %.0f ms",
            frame.index,
            len(lines),
            result.status.value,
            result.added,
            (time.perf_counter() - started) * 1000.0,
        )
