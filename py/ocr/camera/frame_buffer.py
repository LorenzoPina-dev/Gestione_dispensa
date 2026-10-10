"""Buffer thread-safe "ultimo frame vince" tra produttore (camera) e consumatori.

Perche' non una coda classica: se l'OCR e' piu' lento della camera (30 FPS), una coda
accumulerebbe frame vecchi e la latenza crescerebbe. Qui il produttore SOVRASCRIVE il
frame precedente: i consumatori lavorano sempre sul frame piu' recente (frame dropping).
"""
from __future__ import annotations

import threading
from typing import Optional

from ocr.domain.models import Frame


class LatestFrameBuffer:
    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._frame: Optional[Frame] = None
        self._closed = False

    def put(self, frame: Frame) -> None:
        with self._cond:
            self._frame = frame
            self._cond.notify_all()

    def close(self) -> None:
        """Segnala che non arriveranno altri frame; sveglia i consumatori in attesa."""
        with self._cond:
            self._closed = True
            self._cond.notify_all()

    @property
    def closed(self) -> bool:
        with self._cond:
            return self._closed

    def latest(self) -> Optional[Frame]:
        """Ultimo frame disponibile senza attendere (usato dalla UI per il preview)."""
        with self._cond:
            return self._frame

    def get_newer_than(self, last_index: int, timeout: float) -> Optional[Frame]:
        """Attende un frame con index > last_index. None se timeout o buffer chiuso."""
        with self._cond:
            self._cond.wait_for(
                lambda: self._closed
                or (self._frame is not None and self._frame.index > last_index),
                timeout=timeout,
            )
            if self._frame is not None and self._frame.index > last_index:
                return self._frame
            return None
