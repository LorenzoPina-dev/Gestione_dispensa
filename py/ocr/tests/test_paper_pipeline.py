"""Test della pipeline fotometrica + quadrilatero regolare. Da `py/`:
    python -m unittest discover -s ocr/tests -t . -v
"""
from __future__ import annotations

import unittest
from dataclasses import replace
from typing import Optional

import cv2
import numpy as np

from ocr.camera.frame_buffer import LatestFrameBuffer
from ocr.domain.models import Frame, ScanRegion
from ocr.pipeline.scan_session import ScanSession
from ocr.pipeline.status_board import StatusBoard
from ocr.quality.blur_filter import LaplacianBlurFilter
from ocr.quality.enhance import ReceiptEnhancer
from ocr.quality.paper_locator import PaperRegionProvider
from ocr.quality.quad_fit import QuadFitConfig, estimate_tilt_degrees, fit_regular_quad

BACKGROUND = (60, 90, 120)  # BGR marrone
PAPER_W, PAPER_H = 300, 650
STRAIGHT = np.array([[500, 40], [800, 40], [800, 690], [500, 690]], np.float32)


def _receipt(gray: int = 245) -> np.ndarray:
    """Scontrino dritto con nome a sinistra e prezzo a destra (testo su tutta la larghezza)."""
    paper = np.full((PAPER_H, PAPER_W, 3), gray, np.uint8)
    for i, y in enumerate(range(40, PAPER_H - 20, 22)):
        cv2.putText(paper, f"ITEM {i:02d}", (14, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 30, 30), 1, cv2.LINE_AA)
        cv2.putText(paper, "1,29", (240, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 30, 30), 1, cv2.LINE_AA)
    return paper


def _scene(dst_quad: np.ndarray, background=BACKGROUND, gray: int = 245, size=(720, 1280)) -> np.ndarray:
    src = np.array([[0, 0], [PAPER_W - 1, 0], [PAPER_W - 1, PAPER_H - 1], [0, PAPER_H - 1]], np.float32)
    h = cv2.getPerspectiveTransform(src, dst_quad.astype(np.float32))
    warped = cv2.warpPerspective(_receipt(gray), h, (size[1], size[0]))
    mask = cv2.warpPerspective(np.full((PAPER_H, PAPER_W), 255, np.uint8), h, (size[1], size[0]))
    scene = np.full((size[0], size[1], 3), background, np.uint8)
    scene[mask > 0] = warped[mask > 0]
    return scene


class RegularQuadLocatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = PaperRegionProvider()

    def _locate(self, image: np.ndarray) -> ScanRegion:
        region = self.provider.locate(image)
        self.assertIsNotNone(region)
        assert region is not None
        return region

    def test_white_blob_glued_to_a_corner_does_not_skew_the_quad(self) -> None:
        """Il bug segnalato: una busta bianca attaccata all'angolo in basso a sinistra trasformava
        il riquadro in un trapezio storto. Ora il lato sinistro deve restare sul bordo vero."""
        scene = _scene(STRAIGHT)
        cv2.fillPoly(scene, [np.array([[330, 720], [500, 560], [500, 720]], np.int32)], (245, 245, 245))
        quad = self._locate(scene).quad  # TL, TR, BR, BL
        self.assertAlmostEqual(float(quad[3][0]), float(quad[0][0]), delta=8.0)  # BL sotto TL: lato dritto
        self.assertGreater(float(quad[3][0]), 495.0)  # niente sbandata verso la busta (x=330)

    def test_large_leak_is_still_ignored(self) -> None:
        scene = _scene(STRAIGHT)
        cv2.fillPoly(scene, [np.array([[300, 720], [500, 400], [500, 720]], np.int32)], (245, 245, 245))
        quad = self._locate(scene).quad
        self.assertAlmostEqual(float(quad[3][0]), float(quad[0][0]), delta=8.0)

    def test_quad_is_always_a_regular_rectangle(self) -> None:
        """Lati opposti quasi paralleli (convergenza contenuta) anche con prospettiva forte."""
        quad = self._locate(_scene(np.array([[520, 60], [800, 20], [770, 640], [500, 700]], np.float32))).quad

        def angle(a: np.ndarray, b: np.ndarray) -> float:
            return float(np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0])))

        self.assertLess(abs(angle(quad[0], quad[1]) - angle(quad[3], quad[2])), 9.0)  # sopra vs sotto
        self.assertLess(abs(angle(quad[0], quad[3]) - angle(quad[1], quad[2])), 9.0)  # sinistra vs destra

    def test_locator_forces_parallel_sides_instead_of_trapezoid(self) -> None:
        quad = self._locate(_scene(np.array([[520, 60], [800, 20], [770, 640], [500, 700]], np.float32))).quad

        def angle(a: np.ndarray, b: np.ndarray) -> float:
            return float(np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0])))

        self.assertLess(abs(angle(quad[0], quad[1]) - angle(quad[3], quad[2])), 1.0)
        self.assertLess(abs(angle(quad[0], quad[3]) - angle(quad[1], quad[2])), 1.0)

    def test_grey_paper_on_white_wall(self) -> None:
        """Carta grigia (L bassa) su parete bianca: la segmentazione non si basa su 'e' chiaro'."""
        region = self._locate(_scene(STRAIGHT, background=(238, 238, 238), gray=150))
        self.assertAlmostEqual(region.patch.shape[1] / region.patch.shape[0], PAPER_W / PAPER_H, delta=0.08)

    def test_rotated_receipt(self) -> None:
        region = self._locate(_scene(np.array([[560, 40], [800, 170], [640, 700], [400, 560]], np.float32)))
        self.assertGreater(abs(region.quad[1][1] - region.quad[0][1]), 60)  # bordo alto davvero inclinato

    def test_glare_spot_and_colour_cast(self) -> None:
        scene = _scene(STRAIGHT)
        cv2.circle(scene, (650, 200), 30, (255, 255, 255), -1)
        scene = scene.astype(np.float32)
        scene[..., 0] *= 0.75  # dominante calda (luce gialla)
        scene[..., 1] *= 0.92
        region = self._locate(np.clip(scene, 0, 255).astype(np.uint8))
        self.assertAlmostEqual(region.patch.shape[1] / region.patch.shape[0], PAPER_W / PAPER_H, delta=0.08)

    def test_skin_is_not_paper_even_after_white_balance(self) -> None:
        img = np.full((720, 1280, 3), BACKGROUND, np.uint8)
        cv2.rectangle(img, (400, 100), (900, 650), (150, 170, 225), -1)
        self.assertIsNone(self.provider.locate(img))


class QuadFitTests(unittest.TestCase):
    @staticmethod
    def _boundary(quad: np.ndarray):
        mask = np.zeros((270, 480), np.uint8)
        cv2.fillConvexPoly(mask, np.round(quad).astype(np.int32), 255)
        return cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[-2][0].reshape(-1, 2)

    def _fit(self, quad: list) -> Optional[np.ndarray]:
        pts = self._boundary(np.array(quad, np.float32))
        return fit_regular_quad(pts, estimate_tilt_degrees(pts), (480, 270), QuadFitConfig())

    def test_rectangle_is_recovered(self) -> None:
        fitted = self._fit([[150, 20], [330, 20], [330, 250], [150, 250]])
        assert fitted is not None
        np.testing.assert_allclose(fitted, [[150, 20], [330, 20], [330, 250], [150, 250]], atol=2.0)

    def test_mild_perspective_is_preserved(self) -> None:
        quad = [[160, 20], [320, 20], [335, 250], [145, 250]]
        fitted = self._fit(quad)
        assert fitted is not None
        np.testing.assert_allclose(fitted, quad, atol=2.0)

    def test_extreme_convergence_is_clamped(self) -> None:
        fitted = self._fit([[190, 20], [290, 20], [330, 250], [150, 250]])  # ~19 gradi per lato
        assert fitted is not None
        left = np.degrees(np.arctan2(fitted[3][0] - fitted[0][0], fitted[3][1] - fitted[0][1]))
        right = np.degrees(np.arctan2(fitted[2][0] - fitted[1][0], fitted[2][1] - fitted[1][1]))
        self.assertLessEqual(abs(left - right), QuadFitConfig().max_converge_deg + 0.5)

    def test_outliers_on_a_third_of_a_side_are_ignored(self) -> None:
        pts = self._boundary(np.array([[150, 20], [330, 20], [330, 250], [150, 250]], np.float32)).astype(np.float64)
        leak = (pts[:, 0] < 160) & (pts[:, 1] > 170)
        pts[leak, 0] -= 60  # il bordo sinistro "sfonda" in basso (come la busta)
        fitted = fit_regular_quad(pts, 0.0, (480, 270), QuadFitConfig())
        assert fitted is not None
        self.assertAlmostEqual(float(fitted[3][0]), 150.0, delta=3.0)


class EnhancerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.enhancer = ReceiptEnhancer()

    def test_flattens_shading_on_grey_paper_and_keeps_text(self) -> None:
        paper = _receipt(150).astype(np.float32) * np.linspace(0.6, 1.25, PAPER_W, dtype=np.float32)[None, :, None]
        paper = np.clip(paper, 0, 255).astype(np.uint8)
        out = self.enhancer.enhance(paper)
        self.assertEqual(out.shape, paper.shape)
        band_before = cv2.cvtColor(paper, cv2.COLOR_BGR2GRAY)[5:20].astype(float)
        band_after = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)[5:20].astype(float)
        self.assertGreater(band_after.mean(), 235.0)  # carta riportata a bianco
        self.assertLess(band_after.std(), 0.4 * band_before.std())  # gradiente di luce eliminato
        self.assertLess(float(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).min()), 60.0)  # il testo resta scuro

    def test_colour_cast_is_neutralised(self) -> None:
        cast = np.full((200, 200, 3), (170, 200, 235), np.uint8)
        cv2.putText(cast, "TOTALE 12,50", (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (30, 30, 30), 1, cv2.LINE_AA)
        out = self.enhancer.enhance(cast)
        means = out[5:20].reshape(-1, 3).mean(axis=0)
        self.assertLess(float(means.max() - means.min()), 8.0)

    def test_edge_contrast_is_available_on_grey_paper(self) -> None:
        paper = _receipt(150)
        edges = self.enhancer.edge_contrast(paper)
        self.assertEqual(edges.shape, paper.shape[:2])
        self.assertGreater(int(edges.max()), 22)

    def test_small_glare_is_reconstructed(self) -> None:
        scene = np.full((270, 480, 3), (60, 90, 120), np.uint8)
        scene[40:230, 150:330] = (235, 235, 235)
        cv2.circle(scene, (240, 100), 8, (255, 255, 255), -1)
        balanced, glare = self.enhancer.balance_scene(scene)
        self.assertGreater(int(glare.sum()), 0)
        self.assertLess(int(abs(int(balanced[100, 240, 0]) - 235)), 6)

    def test_enhance_never_changes_shape_even_for_tiny_patches(self) -> None:
        tiny = np.full((4, 4, 3), 200, np.uint8)
        self.assertEqual(self.enhancer.enhance(tiny).shape, tiny.shape)


class _FixedRegion:
    def __init__(self, region: Optional[ScanRegion]) -> None:
        self._region = region

    def locate(self, image_bgr: np.ndarray) -> Optional[ScanRegion]:
        return self._region


class _Recorder:
    def __init__(self) -> None:
        self.regions = []

    def on_frame(self, frame: Frame, region: ScanRegion) -> None:
        self.regions.append(region)


class SessionEnhancementTests(unittest.TestCase):
    def _session(self, enhancer) -> tuple:
        rec = _Recorder()
        region = ScanRegion(quad=STRAIGHT.copy(), patch=_receipt())
        session = ScanSession(
            LatestFrameBuffer(), _FixedRegion(region), LaplacianBlurFilter(), rec, StatusBoard(), patch_enhancer=enhancer
        )
        return session, rec, region

    def test_enhanced_patch_reaches_consumer_but_blur_is_measured_on_raw(self) -> None:
        session, rec, region = self._session(ReceiptEnhancer())
        self.assertTrue(session.process_frame(Frame(1, 0.0, _receipt())))
        got = rec.regions[0]
        self.assertIsNotNone(got.enhanced)
        self.assertIs(got.patch, region.patch)  # il patch grezzo non e' stato toccato
        self.assertIs(got.ocr_image, got.enhanced)

    def test_without_enhancer_ocr_gets_the_raw_patch(self) -> None:
        session, rec, region = self._session(None)
        self.assertTrue(session.process_frame(Frame(1, 0.0, _receipt())))
        self.assertIsNone(rec.regions[0].enhanced)
        self.assertIs(rec.regions[0].ocr_image, region.patch)

    def test_scan_region_replace_keeps_quad(self) -> None:
        region = ScanRegion(quad=STRAIGHT.copy(), patch=_receipt())
        again = replace(region, enhanced=region.patch)
        np.testing.assert_array_equal(again.quad, region.quad)


if __name__ == "__main__":
    unittest.main()
