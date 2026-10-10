"""Stato dello scontrino accumulato, condiviso tra worker (scrive) e UI (legge)."""
from __future__ import annotations

import threading
from typing import List, Sequence

from ocr.merging.line_merger import LineMerger, MergeResult


class ReceiptAccumulator:
    def __init__(self, merger: LineMerger = LineMerger()) -> None:
        self._merger = merger
        self._lock = threading.Lock()
        self._lines: List[str] = []

    def update(self, new_lines: Sequence[str]) -> MergeResult:
        with self._lock:
            result = self._merger.merge(self._lines, new_lines)
            self._lines = list(result.lines)
            return result

    def snapshot(self) -> List[str]:
        with self._lock:
            return list(self._lines)

    def reset(self) -> None:
        with self._lock:
            self._lines = []
