from __future__ import annotations

import cv2
import numpy as np

from ocr.quality.paper_locator import order_quad, rectify


def validate_quad(quad: np.ndarray, shape: tuple[int, ...]) -> tuple[bool, tuple[str, ...]]:
    if quad.shape != (4, 2) or not np.isfinite(quad).all():
        return False, ("invalid_corner_shape",)
    points = order_quad(quad.astype(np.float32))
    area = abs(float(cv2.contourArea(points)))
    if area < 100.0:
        return False, ("small_area",)
    if not cv2.isContourConvex(points.reshape(-1, 1, 2)):
        return False, ("non_convex",)
    cross = []
    for index in range(4):
        a = points[index]
        b = points[(index + 1) % 4]
        c = points[(index + 2) % 4]
        first = b - a
        second = c - b
        cross.append(float(first[0] * second[1] - first[1] * second[0]))
    if min(cross) <= 0 or max(cross) / max(min(cross), 1e-6) > 12:
        return False, ("degenerate_geometry",)
    height, width = shape[:2]
    outside = np.any((points[:, 0] < -width * 0.1) | (points[:, 0] > width * 1.1) |
                     (points[:, 1] < -height * 0.1) | (points[:, 1] > height * 1.1))
    return True, ("truncated",) if outside else ()


def rectify_candidate(image: np.ndarray, quad: np.ndarray, max_side: int = 1600) -> np.ndarray:
    patch = rectify(image, order_quad(quad.astype(np.float32)), max_side)
    if patch is None:
        raise ValueError("Quadrilatero non rettificabile")
    return patch
