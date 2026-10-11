from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from ocr.quality.enhance import ReceiptEnhancer


@dataclass(frozen=True)
class ImageViews:
    original: np.ndarray
    balanced: np.ndarray
    gray: np.ndarray
    clahe: np.ndarray
    edges: np.ndarray


def make_views(image: np.ndarray, enhancer: ReceiptEnhancer | None = None) -> ImageViews:
    """Produce viste ausiliarie mantenendo l'originale come riferimento geometrico."""
    enhancer = enhancer or ReceiptEnhancer()
    balanced, _ = enhancer.balance_scene(image)
    gray = cv2.cvtColor(balanced, cv2.COLOR_BGR2GRAY)
    clahe = enhancer.seed_gray(balanced)
    edges = cv2.Canny(clahe, 50, 150)
    return ImageViews(image.copy(), balanced, gray, clahe, edges)
