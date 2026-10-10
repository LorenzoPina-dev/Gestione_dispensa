"""Test moduli 1-2. Esecuzione dalla cartella `py/`:  python -m unittest discover -s ocr/tests -t . -v"""
from __future__ import annotations

import unittest

import cv2
import numpy as np

from ocr.camera.frame_buffer import LatestFrameBuffer
from ocr.config import BlurFilterConfig, ScanAreaConfig
from ocr.domain.geometry import ScanAreaGeometry
from ocr.domain.models import Frame, Rect
from ocr.pipeline.scan_session import ScanSession
from ocr.pipeline.status_board import StatusBoard
from ocr.quality.blur_filter import LaplacianBlurFilter


def _text_like_image(h: int = 480, w: int = 360) -> np.ndarray:
    img = np.full((h, w, 3), 255, np.uint8)
    for i, y in enumerate(range(30, h - 30, 28)):
        for x in range(10, w - 150, 180):
            cv2.putText(img, f"ITEM {i:02d} {i * 1.37:5.2f}", (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)
    return img


class BlurFilterTests(unittest.TestCase):
    def test_sharp_scores_higher_than_blurred(self) -> None:
        f = LaplacianBlurFilter(BlurFilterConfig(threshold=100.0))
        sharp = _text_like_image()
        blurred = cv2.GaussianBlur(sharp, (15, 15), 5)
        self.assertGreater(f.evaluate(sharp).score, f.evaluate(blurred).score)
        self.assertTrue(f.evaluate(sharp).passed)
        self.assertFalse(f.evaluate(blurred).passed)

    def test_empty_image_is_rejected(self) -> None:
        f = LaplacianBlurFilter()
        self.assertFalse(f.evaluate(np.zeros((0, 0, 3), np.uint8)).passed)

    def test_flat_image_has_zero_variance(self) -> None:
        f = LaplacianBlurFilter(BlurFilterConfig(normalize_width=None))
        self.assertAlmostEqual(f.evaluate(np.full((50, 50), 128, np.uint8)).score, 0.0)


class GeometryTests(unittest.TestCase):
    def test_roi_is_centered_and_keeps_aspect(self) -> None:
        roi = ScanAreaGeometry(ScanAreaConfig()).compute_roi(1280, 720)
        self.assertEqual(roi.height, 648)  # 0.9 * 720
        self.assertAlmostEqual(roi.width / roi.height, 0.6, places=2)
        self.assertEqual(roi.x, (1280 - roi.width) // 2)

    def test_portrait_frame_is_width_limited(self) -> None:
        roi = ScanAreaGeometry(ScanAreaConfig()).compute_roi(720, 1280)
        self.assertLessEqual(roi.width, int(720 * 0.9) + 1)
        self.assertLessEqual(roi.y2, 1280)


class _Recorder:
    def __init__(self) -> None:
        self.frames: list[Frame] = []

    def on_frame(self, frame: Frame, roi: Rect) -> None:
        self.frames.append(frame)


class ScanSessionTests(unittest.TestCase):
    def _session(self) -> tuple[ScanSession, _Recorder, StatusBoard]:
        rec, board = _Recorder(), StatusBoard()
        s = ScanSession(LatestFrameBuffer(), ScanAreaGeometry(ScanAreaConfig()), LaplacianBlurFilter(), rec, board)
        return s, rec, board

    def test_blurry_frame_is_dropped_early(self) -> None:
        s, rec, board = self._session()
        blurred = cv2.GaussianBlur(_text_like_image(720, 1280), (31, 31), 10)
        self.assertFalse(s.process_frame(Frame(1, 0.0, blurred)))
        self.assertEqual(rec.frames, [])
        self.assertEqual(board.snapshot().rejected, 1)

    def test_sharp_frame_reaches_consumer(self) -> None:
        s, rec, board = self._session()
        self.assertTrue(s.process_frame(Frame(1, 0.0, _text_like_image(720, 1280))))
        self.assertEqual(len(rec.frames), 1)
        self.assertEqual(board.snapshot().accepted, 1)


class BufferTests(unittest.TestCase):
    def test_latest_frame_wins(self) -> None:
        b = LatestFrameBuffer()
        img = np.zeros((2, 2, 3), np.uint8)
        b.put(Frame(1, 0.0, img))
        b.put(Frame(2, 0.0, img))
        got = b.get_newer_than(0, timeout=0.1)
        self.assertIsNotNone(got)
        self.assertEqual(got.index, 2)
        self.assertIsNone(b.get_newer_than(2, timeout=0.05))


if __name__ == "__main__":
    unittest.main()
