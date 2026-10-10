"""Stato condiviso worker -> UI, protetto da lock."""
from __future__ import annotations

import threading
from typing import Optional

import numpy as np

from ocr.domain.models import QualityResult, ScanStatus


class StatusBoard:
    """Il worker scrive, la UI legge snapshot immutabili (ScanStatus)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status = ScanStatus()

    def record(
        self,
        frame_index: int,
        quality: Optional[QualityResult],
        accepted: bool,
        quad: Optional[np.ndarray] = None,
    ) -> None:
        with self._lock:
            s = self._status
            self._status = ScanStatus(
                frame_index=frame_index,
                quality=quality,
                accepted=s.accepted + (1 if accepted else 0),
                rejected=s.rejected + (0 if accepted else 1),
                quad=quad,
            )

    def snapshot(self) -> ScanStatus:
        with self._lock:
            return self._status
