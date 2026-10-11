from __future__ import annotations

import numpy as np
import cv2

from ocr.document_ai.models import CandidateRegion, Decision, ImageQuality


def image_quality(image: np.ndarray, warn_threshold: float = 35.0,
                  recapture_threshold: float = 12.0) -> ImageQuality:
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    sharpness = float(np.var(cv2.Laplacian(gray, cv2.CV_32F)))
    contrast = float(np.std(gray))
    clipped = float(np.mean((gray <= 3) | (gray >= 252)))
    warnings = []
    if clipped > 0.18:
        warnings.append("exposure_clipping")
    if sharpness < recapture_threshold:
        return ImageQuality(sharpness, contrast, clipped, Decision.RECAPTURE, tuple(warnings + ["blur"]))
    if sharpness < warn_threshold or contrast < 10:
        return ImageQuality(sharpness, contrast, clipped, Decision.WARN, tuple(warnings + ["low_quality"]))
    return ImageQuality(sharpness, contrast, clipped, Decision.ACCEPT, tuple(warnings))


def candidate_confidence(candidate: CandidateRegion, quality: ImageQuality,
                         text_score: float = 0.0) -> float:
    detector = candidate.scores.get("detector", 0.0)
    geometry = 0.0 if "degenerate_geometry" in candidate.warnings else 1.0
    quality_score = 1.0 if quality.decision == Decision.ACCEPT else 0.55
    return float(np.clip(0.40 * detector + 0.25 * geometry + 0.20 * quality_score + 0.15 * text_score, 0, 1))
