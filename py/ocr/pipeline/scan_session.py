"""ScanSession: worker in background che localizza lo scontrino, filtra e inoltra i frame buoni."""
from __future__ import annotations

import logging
import threading
from dataclasses import replace
from typing import Optional

from ocr.camera.frame_buffer import LatestFrameBuffer
from ocr.domain.models import Frame
from ocr.domain.ports import FrameConsumer, PatchEnhancer, QualityFilter, RegionProvider
from ocr.pipeline.status_board import StatusBoard

log = logging.getLogger(__name__)


class ScanSession:
    """Collega: buffer (camera) -> ROI -> quality filter -> consumer (OCR).

    Gira su un thread dedicato ("scan-worker"): la UI non viene mai bloccata e, grazie
    al LatestFrameBuffer, se l'elaborazione e' lenta i frame intermedi vengono saltati
    invece di accumularsi.
    """

    _POLL_TIMEOUT_S = 0.2

    def __init__(
        self,
        buffer: LatestFrameBuffer,
        roi_provider: RegionProvider,
        quality_filter: QualityFilter,
        consumer: FrameConsumer,
        status_board: StatusBoard,
        patch_enhancer: Optional[PatchEnhancer] = None,
    ) -> None:
        self._buffer = buffer
        self._roi_provider = roi_provider
        self._quality_filter = quality_filter
        self._consumer = consumer
        self._status_board = status_board
        self._patch_enhancer = patch_enhancer
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="scan-worker", daemon=True)
        self._thread.start()

    def join(self, timeout: Optional[float] = None) -> None:
        """Attende che il worker finisca da solo (buffer chiuso e ultimo frame elaborato)."""
        if self._thread is not None:
            self._thread.join(timeout)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    # -------------------------------------------------------------------- worker
    def _run(self) -> None:
        last_index = 0
        while not self._stop_event.is_set():
            frame = self._buffer.get_newer_than(last_index, self._POLL_TIMEOUT_S)
            if frame is None:
                if self._buffer.closed:
                    break
                continue
            last_index = frame.index
            try:
                self.process_frame(frame)
            except Exception:  # un frame difettoso non deve uccidere la sessione
                log.exception("Errore nell'elaborazione del frame %d", frame.index)

    def process_frame(self, frame: Frame) -> bool:
        """Elabora un singolo frame. True se e' stato inoltrato al consumer.

        Pubblico per poterlo testare in modo sincrono, senza thread.
        """
        region = self._roi_provider.locate(frame.image)
        if region is None:
            # Scontrino non trovato (o troppo irregolare): niente da leggere.
            self._status_board.record(frame.index, None, accepted=False, quad=None)
            return False

        # Nitidezza misurata sull'immagine RADDRIZZATA della sola carta.
        quality = self._quality_filter.evaluate(region.patch)
        if not quality.passed:
            # EARLY RETURN: frame sfocato scartato subito, nessun costo di OCR.
            self._status_board.record(frame.index, quality, accepted=False, quad=region.quad)
            return False

        self._status_board.record(frame.index, quality, accepted=True, quad=region.quad)
        if self._patch_enhancer is not None:
            # Solo ora (frame gia' accettato): il costo dell'enhancement non pesa sugli scartati.
            region = replace(region, enhanced=self._patch_enhancer.enhance(region.patch))
        self._consumer.on_frame(frame, region)
        return True
