"""Ritaglio di una regione di testo da un box a 4 punti (correzione prospettica)."""
from __future__ import annotations

import cv2
import numpy as np


def crop_text_region(image_bgr: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Raddrizza il quadrilatero TL, TR, BR, BL in un rettangolo.

    Larghezza/altezza di destinazione = lati piu' lunghi del quadrilatero.
    La matrice M (3x3) mappa i 4 punti sorgente sui 4 angoli del rettangolo:
        [x', y', w']^T = M [x, y, 1]^T ,   (X, Y) = (x'/w', y'/w')
    """
    tl, tr, br, bl = points.astype(np.float32)
    width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    width, height = max(width, 1), max(height, 1)

    dst = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], dtype=np.float32), dst)
    crop = cv2.warpPerspective(
        image_bgr, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )

    # Testo verticale (molto piu' alto che largo): ruota di 90 gradi.
    if height / float(width) >= 1.5:
        crop = np.rot90(crop)
    return np.ascontiguousarray(crop)
