"""Quality gate multi-evidenza per fotografie di scontrini."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from ocr.domain.models import QualityResult, ScanRegion


@dataclass(frozen=True)
class QualityGateConfig:
    threshold: float = 0.28
    min_sharpness: float = 35.0
    max_clipped_fraction: float = 0.18
    min_contrast: float = 10.0
    min_text_fraction: float = 0.002


class ReceiptQualityGate:
    """Valuta qualità ottica e contenuto, separando il caso sfocato dal falso documento."""

    def __init__(self, config: QualityGateConfig = QualityGateConfig()) -> None:
        self._cfg = config

    def evaluate(self, region: ScanRegion) -> QualityResult:
        patch = region.patch
        if patch is None or patch.size == 0:
            return QualityResult(0.0, self._cfg.threshold, "empty_patch")
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY) if patch.ndim == 3 else patch
        lap = cv2.Laplacian(gray, cv2.CV_32F)
        sharpness = float(np.var(lap))
        contrast = float(np.std(gray))
        clipped = float(np.mean((gray <= 3) | (gray >= 252)))
        blackhat = cv2.morphologyEx(
            gray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        )
        text_fraction = float(np.mean(blackhat >= max(8.0, np.percentile(blackhat, 85.0))))
        sharp_score = float(np.clip(sharpness / max(self._cfg.min_sharpness * 3.0, 1.0), 0.0, 1.0))
        contrast_score = float(np.clip(contrast / 48.0, 0.0, 1.0))
        exposure_score = float(np.clip(1.0 - clipped / self._cfg.max_clipped_fraction, 0.0, 1.0))
        text_score = float(np.clip(text_fraction / (self._cfg.min_text_fraction * 8.0), 0.0, 1.0))
        detector_score = float(np.clip(region.confidence, 0.0, 1.0))
        score = 0.30 * sharp_score + 0.20 * contrast_score + 0.15 * exposure_score + 0.20 * text_score + 0.15 * detector_score
        reason = ""
        if sharpness < self._cfg.min_sharpness:
            reason = "blur"
        elif clipped > self._cfg.max_clipped_fraction:
            reason = "clipped_or_glare"
        elif text_fraction < self._cfg.min_text_fraction:
            reason = "insufficient_text"
        if reason in ("blur", "insufficient_text"):
            score = min(score, self._cfg.threshold * 0.5)
        return QualityResult(
            score=score,
            threshold=self._cfg.threshold,
            reason=reason,
            metrics={
                "sharpness": sharpness,
                "contrast": contrast,
                "clipped_fraction": clipped,
                "text_fraction": text_fraction,
                "detector_confidence": detector_score,
            },
        )
