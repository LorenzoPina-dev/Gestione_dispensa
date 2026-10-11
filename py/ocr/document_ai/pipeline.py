from __future__ import annotations

from typing import Optional

import numpy as np

from ocr.document_ai.confidence import candidate_confidence, image_quality
from ocr.document_ai.geometry import rectify_candidate, validate_quad
from ocr.document_ai.models import PipelineResult, ReceiptInstance
from ocr.document_ai.ocr import OCRBackend
from ocr.document_ai.postprocess import structure_receipt
from ocr.document_ai.proposals import LearnedDetector, propose_regions
from ocr.quality.paper_locator import PaperRegionProvider


class ReceiptPipeline:
    """Orchestratore baseline: OpenCV subito, detector/OCR appresi opzionali."""

    def __init__(self, locator: Optional[PaperRegionProvider] = None,
                 detector: Optional[LearnedDetector] = None,
                 ocr: Optional[OCRBackend] = None,
                 max_instances: int = 8) -> None:
        self.locator = locator or PaperRegionProvider()
        self.detector = detector
        self.ocr = ocr
        self.max_instances = max_instances

    def process(self, image_bgr: np.ndarray) -> PipelineResult:
        quality = image_quality(image_bgr)
        candidates = propose_regions(image_bgr, self.locator, self.detector)
        instances = []
        for candidate in candidates[: self.max_instances]:
            valid, warnings = validate_quad(candidate.quad, image_bgr.shape)
            if not valid:
                continue
            candidate = type(candidate)(candidate.quad, candidate.mask, candidate.source, candidate.scores,
                                        tuple(candidate.warnings) + warnings)
            patch = rectify_candidate(image_bgr, candidate.quad)
            ocr_result = self.ocr.predict(patch) if self.ocr is not None else None
            structured = structure_receipt(ocr_result) if ocr_result is not None else None
            text_score = ocr_result.confidence if ocr_result is not None else 0.0
            instances.append(ReceiptInstance(candidate, patch, quality, ocr_result, structured,
                                             candidate_confidence(candidate, quality, text_score)))
        instances.sort(key=lambda item: item.confidence, reverse=True)
        warnings = quality.warnings
        if not instances:
            warnings = warnings + ("no_receipt_candidate",)
        return PipelineResult(quality, tuple(instances), warnings)
