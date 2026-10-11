from __future__ import annotations

import unittest

import cv2
import numpy as np

from ocr.document_ai import ReceiptPipeline
from ocr.document_ai.confidence import image_quality
from ocr.document_ai.geometry import validate_quad
from ocr.document_ai.models import Decision


class DocumentAiTests(unittest.TestCase):
    def test_quality_rejects_empty_detail(self) -> None:
        result = image_quality(np.zeros((80, 80, 3), np.uint8))
        self.assertEqual(result.decision, Decision.RECAPTURE)

    def test_geometry_rejects_degenerate_quad(self) -> None:
        valid, reasons = validate_quad(np.zeros((4, 2), np.float32), (100, 100, 3))
        self.assertFalse(valid)
        self.assertTrue(reasons)

    def test_pipeline_returns_explicit_empty_result(self) -> None:
        result = ReceiptPipeline().process(np.full((160, 220, 3), 90, np.uint8))
        self.assertIsInstance(result.instances, tuple)
        self.assertTrue(result.warnings)

    def test_quality_accepts_detailed_synthetic_patch(self) -> None:
        image = np.full((160, 220, 3), 235, np.uint8)
        for y in range(20, 150, 12):
            cv2.line(image, (15, y), (205, y), (30, 30, 30), 1)
        self.assertNotEqual(image_quality(image).decision, Decision.RECAPTURE)
