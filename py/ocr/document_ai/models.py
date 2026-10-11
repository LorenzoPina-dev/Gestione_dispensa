from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import numpy as np


class Decision(str, Enum):
    ACCEPT = "accept"
    WARN = "warn"
    RECAPTURE = "recapture"


@dataclass(frozen=True)
class ImageQuality:
    sharpness: float
    contrast: float
    clipped_fraction: float
    decision: Decision
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class CandidateRegion:
    quad: np.ndarray
    mask: Optional[np.ndarray]
    source: str
    scores: dict[str, float] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class OCRResult:
    text: str
    confidence: float
    lines: tuple[str, ...] = ()
    raw: Any = None


@dataclass(frozen=True)
class StructuredReceipt:
    merchant: Optional[str] = None
    date: Optional[str] = None
    total: Optional[str] = None
    items: tuple[dict[str, str], ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class ReceiptInstance:
    candidate: CandidateRegion
    patch: np.ndarray
    quality: ImageQuality
    ocr: Optional[OCRResult] = None
    structured: Optional[StructuredReceipt] = None
    confidence: float = 0.0


@dataclass(frozen=True)
class PipelineResult:
    quality: ImageQuality
    instances: tuple[ReceiptInstance, ...]
    warnings: tuple[str, ...] = ()
    debug_paths: tuple[str, ...] = ()
