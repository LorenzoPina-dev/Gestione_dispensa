"""Test localizzatore/raddrizzamento e sessione. Da `py/`:  python -m unittest discover -s ocr/tests -t . -v"""
from __future__ import annotations

import unittest
from typing import Optional

import cv2
import numpy as np

from ocr.camera.frame_buffer import LatestFrameBuffer
from ocr.domain.models import Frame, ScanRegion
from ocr.pipeline.scan_session import ScanSession
from ocr.pipeline.status_board import StatusBoard
from ocr.quality.blur_filter import LaplacianBlurFilter
from ocr.quality.paper_locator import PaperRegionProvider, order_quad, rectify

BACKGROUND = (60, 90, 120)  # BGR marrone: croma alto, non e' "carta"
PAPER_W, PAPER_H = 300, 650


def _upright_receipt() -> np.ndarray:
    paper = np.full((PAPER_H, PAPER_W, 3), 245, np.uint8)
    for i, y in enumerate(range(40, PAPER_H - 20, 22)):
        cv2.putText(paper, f"ITEM {i:02d}    1,29", (14, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 30, 30), 1, cv2.LINE_AA)
    return paper


def _scene(dst_quad: np.ndarray, size=(720, 1280)) -> np.ndarray:
    """Scontrino dritto proiettato su `dst_quad` (TL, TR, BR, BL) sopra uno sfondo colorato."""
    paper = _upright_receipt()
    src = np.array([[0, 0], [PAPER_W - 1, 0], [PAPER_W - 1, PAPER_H - 1], [0, PAPER_H - 1]], np.float32)
    h = cv2.getPerspectiveTransform(src, dst_quad.astype(np.float32))
    warped = cv2.warpPerspective(paper, h, (size[1], size[0]))
    mask = cv2.warpPerspective(np.full((PAPER_H, PAPER_W), 255, np.uint8), h, (size[1], size[0]))
    scene = np.full((size[0], size[1], 3), BACKGROUND, np.uint8)
    scene[mask > 0] = warped[mask > 0]
    return scene


def _row_contrast(image_bgr: np.ndarray) -> float:
    """Quanto le righe di testo sono 'a bande' orizzontali: std del profilo medio per riga.
    Testo inclinato -> profilo piatto -> valore basso."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    inner = gray[int(0.05 * gray.shape[0]) : int(0.95 * gray.shape[0]), int(0.05 * gray.shape[1]) : int(0.95 * gray.shape[1])]
    return float(inner.mean(axis=1).std())


class PaperLocatorTests(unittest.TestCase):
    def test_straight_receipt(self) -> None:
        quad = np.array([[500, 40], [800, 40], [800, 690], [500, 690]])
        region = PaperRegionProvider().locate(_scene(quad))
        self.assertIsNotNone(region)
        assert region is not None
        self.assertAlmostEqual(region.patch.shape[1] / region.patch.shape[0], PAPER_W / PAPER_H, delta=0.08)

    def test_tilted_receipt_is_straightened(self) -> None:
        # Inclinato di ~15 gradi e in prospettiva (lato destro piu' corto): trapezio ruotato.
        quad = np.array([[520, 60], [800, 20], [770, 640], [500, 700]])
        scene = _scene(quad)
        region = PaperRegionProvider().locate(scene)
        self.assertIsNotNone(region)
        assert region is not None
        self.assertAlmostEqual(region.patch.shape[1] / region.patch.shape[0], PAPER_W / PAPER_H, delta=0.12)

        # Il quadrilatero segue davvero la carta: non e' un rettangolo allineato agli assi.
        top_edge = region.quad[1] - region.quad[0]
        self.assertGreater(abs(top_edge[1]), 15)

        # Confronto: ritaglio ingenuo (bounding box del quad) vs patch raddrizzato.
        x0, y0 = np.floor(region.quad.min(axis=0)).astype(int)
        x1, y1 = np.ceil(region.quad.max(axis=0)).astype(int)
        naive = scene[y0:y1, x0:x1]
        self.assertGreater(_row_contrast(region.patch), 1.3 * _row_contrast(naive))

    def test_no_paper_returns_none(self) -> None:
        self.assertIsNone(PaperRegionProvider().locate(np.full((720, 1280, 3), BACKGROUND, np.uint8)))

    def test_skin_like_region_is_not_paper(self) -> None:
        img = np.full((720, 1280, 3), BACKGROUND, np.uint8)
        cv2.rectangle(img, (400, 100), (900, 650), (150, 170, 225), -1)  # tinta pelle chiara (croma caldo)
        self.assertIsNone(PaperRegionProvider().locate(img))

    def test_irregular_bright_region_is_rejected(self) -> None:
        img = np.full((720, 1280, 3), BACKGROUND, np.uint8)
        cv2.rectangle(img, (300, 310), (900, 410), (245, 245, 245), -1)  # croce: parete/riflesso, non carta
        cv2.rectangle(img, (550, 60), (650, 660), (245, 245, 245), -1)
        self.assertIsNone(PaperRegionProvider().locate(img))

    def test_shadowed_half_is_still_paper(self) -> None:
        """Luce non uniforme: meta' carta in ombra (L piu' bassa) deve restare dentro il quad."""
        quad = np.array([[500, 40], [800, 40], [800, 690], [500, 690]])
        scene = _scene(quad)
        scene[:, 500:650] = (scene[:, 500:650] * 0.7).astype(np.uint8)  # ombra sulla meta' sinistra
        region = PaperRegionProvider().locate(scene)
        self.assertIsNotNone(region)
        assert region is not None
        self.assertLess(region.quad[:, 0].min(), 540)  # il quad include anche la parte in ombra


class QuadHelpersTests(unittest.TestCase):
    def test_order_quad(self) -> None:
        pts = np.array([[10, 90], [100, 10], [10, 10], [100, 90]], np.float32)
        ordered = order_quad(pts)
        np.testing.assert_array_equal(ordered, np.array([[10, 10], [100, 10], [100, 90], [10, 90]], np.float32))

    def test_rectify_unit_square(self) -> None:
        img = np.zeros((200, 200, 3), np.uint8)
        quad = np.array([[50, 50], [150, 50], [150, 150], [50, 150]], np.float32)
        patch = rectify(img, quad, max_side=1600)
        assert patch is not None
        self.assertEqual(patch.shape[:2], (100, 100))


class _FixedRegion:
    def __init__(self, region: Optional[ScanRegion]) -> None:
        self._region = region

    def locate(self, image_bgr: np.ndarray) -> Optional[ScanRegion]:
        return self._region


class _Recorder:
    def __init__(self) -> None:
        self.count = 0

    def on_frame(self, frame: Frame, region: ScanRegion) -> None:
        self.count += 1


class SessionWithRegionTests(unittest.TestCase):
    def test_receipt_not_found_skips_frame(self) -> None:
        rec, board = _Recorder(), StatusBoard()
        session = ScanSession(LatestFrameBuffer(), _FixedRegion(None), LaplacianBlurFilter(), rec, board)
        self.assertFalse(session.process_frame(Frame(1, 0.0, _upright_receipt())))
        self.assertEqual(rec.count, 0)
        status = board.snapshot()
        self.assertIsNone(status.quad)
        self.assertIsNone(status.quality)
        self.assertEqual(status.rejected, 1)

    def test_status_carries_quad_and_patch_reaches_consumer(self) -> None:
        rec, board = _Recorder(), StatusBoard()
        region = ScanRegion(quad=np.array([[0, 0], [10, 0], [10, 10], [0, 10]], np.float32), patch=_upright_receipt())
        session = ScanSession(LatestFrameBuffer(), _FixedRegion(region), LaplacianBlurFilter(), rec, board)
        self.assertTrue(session.process_frame(Frame(1, 0.0, _upright_receipt())))
        self.assertEqual(rec.count, 1)
        np.testing.assert_array_equal(board.snapshot().quad, region.quad)


if __name__ == "__main__":
    unittest.main()
