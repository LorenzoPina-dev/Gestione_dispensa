"""CameraFeed: acquisizione video a 30 FPS su thread in background (non blocca la UI)."""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

import cv2

from ocr.camera.frame_buffer import LatestFrameBuffer
from ocr.config import CameraConfig
from ocr.domain.models import Frame

log = logging.getLogger(__name__)


class CameraError(RuntimeError):
    """Camera non apribile o non disponibile."""


class CameraFeed:
    """Implementa la porta `FrameSource`.

    Thread model:
        - thread "camera-feed": cap.read() in loop, pubblica nel LatestFrameBuffer.
        - la UI e il worker OCR leggono dal buffer e non toccano mai VideoCapture.
    """

    def __init__(self, config: CameraConfig, buffer: Optional[LatestFrameBuffer] = None) -> None:
        self._config = config
        self.buffer = buffer if buffer is not None else LatestFrameBuffer()
        self._capture: Optional[cv2.VideoCapture] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return

        cfg = self._config
        capture = cv2.VideoCapture(cfg.source, cfg.backend)
        if not capture.isOpened():
            capture.release()
            raise CameraError(f"Impossibile aprire la sorgente video: {cfg.source!r}")

        if not cfg.is_file:
            # Richieste "best effort": il driver puo' scegliere valori diversi.
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.width)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.height)
            capture.set(cv2.CAP_PROP_FPS, cfg.fps)
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # minimizza la latenza interna del driver
            capture.set(cv2.CAP_PROP_AUTOFOCUS, 1 if cfg.autofocus else 0)

        log.info(
            "Camera aperta: %dx%d @ %.1f FPS",
            int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            capture.get(cv2.CAP_PROP_FPS),
        )

        self._capture = capture
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="camera-feed", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ----------------------------------------------------------------- thread body
    def _run(self) -> None:
        cfg = self._config
        capture = self._capture
        assert capture is not None

        # Una camera reale e' gia' paced dal driver (cap.read() blocca fino al frame
        # successivo). Un file video invece viene letto alla massima velocita': lo
        # rallentiamo a cfg.fps per simulare il live.
        frame_interval = 1.0 / cfg.fps if cfg.is_file else 0.0

        index = 0
        failures = 0
        try:
            while not self._stop_event.is_set():
                started = time.monotonic()
                ok, image = capture.read()

                if not ok or image is None:
                    if cfg.is_file:
                        log.info("Fine del file video.")
                        break
                    failures += 1
                    if failures >= cfg.max_read_failures:
                        log.error("Camera non risponde: %d letture fallite.", failures)
                        break
                    time.sleep(0.01)
                    continue

                failures = 0
                index += 1
                self.buffer.put(Frame(index=index, timestamp=started, image=image))

                if frame_interval:
                    remaining = frame_interval - (time.monotonic() - started)
                    if remaining > 0:
                        time.sleep(remaining)
        finally:
            capture.release()
            self.buffer.close()
