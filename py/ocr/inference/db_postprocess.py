"""Post-processing di DBNet (Differentiable Binarization): mappa di probabilita' -> box.

Passi
-----
1) Binarizzazione:   B(x, y) = 1 se P(x, y) > bin_threshold
2) Contorni:         ogni componente connessa e' un candidato di testo.
3) Rettangolo minimo ruotato (minAreaRect) del contorno.
4) Score del box:    media di P dentro il box. Scarta se < box_threshold.
5) Unclip:           DBNet e' addestrato su regioni RIDOTTE ("shrunk text kernel"), quindi
                     il box va riespanso. Con Vatti clipping l'offset e'
                         d = A * r / L        (A = area, L = perimetro, r = unclip_ratio)
                     Per un rettangolo w x h: A = w*h, L = 2(w+h), e l'offset d su ogni lato
                     equivale a un rettangolo (w + 2d) x (h + 2d) con stesso centro e angolo:
                     nessun bisogno di pyclipper.
6) Riscalatura dalle coordinate della mappa a quelle dell'immagine originale.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

import cv2
import numpy as np

from ocr.domain.ocr_models import TextBox


@dataclass(frozen=True)
class DBConfig:
    bin_threshold: float = 0.3
    box_threshold: float = 0.6
    unclip_ratio: float = 1.5
    min_size: float = 3.0
    max_candidates: int = 1000


def order_points(points: np.ndarray) -> np.ndarray:
    """Ordina 4 punti come TL, TR, BR, BL (ordinando per y, poi per x)."""
    by_y = points[np.argsort(points[:, 1])]
    top = by_y[:2][np.argsort(by_y[:2, 0])]
    bottom = by_y[2:][np.argsort(by_y[2:, 0])]
    return np.array([top[0], top[1], bottom[1], bottom[0]], dtype=np.float32)


class DBPostProcessor:
    def __init__(self, config: DBConfig = DBConfig()) -> None:
        self._cfg = config

    def boxes_from_probability(self, prob: np.ndarray, orig_width: int, orig_height: int) -> List[TextBox]:
        """prob: (Hm, Wm) float32 in [0, 1]. Box restituiti in coordinate (orig_width x orig_height)."""
        cfg = self._cfg
        map_h, map_w = prob.shape
        bitmap = (prob > cfg.bin_threshold).astype(np.uint8) * 255

        contours = cv2.findContours(bitmap, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]
        boxes: List[TextBox] = []

        for contour in contours[: cfg.max_candidates]:
            rect = cv2.minAreaRect(contour)
            if min(rect[1]) < cfg.min_size:
                continue

            score = self._box_score(prob, order_points(cv2.boxPoints(rect)))
            if score < cfg.box_threshold:
                continue

            expanded = self._unclip(rect)
            if min(expanded[1]) < cfg.min_size + 2:
                continue

            pts = order_points(cv2.boxPoints(expanded))
            pts[:, 0] = np.clip(pts[:, 0] * orig_width / map_w, 0, orig_width - 1)
            pts[:, 1] = np.clip(pts[:, 1] * orig_height / map_h, 0, orig_height - 1)
            boxes.append(TextBox(points=pts, score=float(score)))

        return boxes

    def _unclip(self, rect):
        (cx, cy), (w, h), angle = rect
        distance = (w * h * self._cfg.unclip_ratio) / (2.0 * (w + h))  # d = A*r / L
        return ((cx, cy), (w + 2 * distance, h + 2 * distance), angle)

    @staticmethod
    def _box_score(prob: np.ndarray, box: np.ndarray) -> float:
        """Media della probabilita' dentro il poligono (maschera locale sul bounding rect)."""
        h, w = prob.shape
        x0 = int(np.clip(np.floor(box[:, 0].min()), 0, w - 1))
        x1 = int(np.clip(np.ceil(box[:, 0].max()), 0, w - 1))
        y0 = int(np.clip(np.floor(box[:, 1].min()), 0, h - 1))
        y1 = int(np.clip(np.ceil(box[:, 1].max()), 0, h - 1))

        mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=np.uint8)
        shifted = (box - np.array([x0, y0], dtype=np.float32)).astype(np.int32)
        cv2.fillPoly(mask, [shifted], 1)
        return float(cv2.mean(prob[y0 : y1 + 1, x0 : x1 + 1], mask)[0])
