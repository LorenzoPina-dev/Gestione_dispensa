"""Overlay AR: quadrilatero di scansione (anche inclinato/in prospettiva), dimming esterno
e HUD di nitidezza.

Strato UI: l'unico che conosce colori e testo. Legge ScanStatus, non chiama mai ML/CV.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import cv2
import numpy as np

from ocr.domain.models import ScanStatus

Color = Tuple[int, int, int]  # BGR


@dataclass(frozen=True)
class OverlayStyle:
    dim_factor: float = 0.35  # luminosita' fuori dalla carta (0 = nero, 1 = invariato)
    neutral: Color = (255, 255, 255)
    ok: Color = (80, 200, 60)
    bad: Color = (60, 60, 230)
    corner_length_ratio: float = 0.12  # lunghezza dei "reggi-angolo" / lunghezza del lato
    corner_thickness: int = 4
    font_scale: float = 0.6


class ScanOverlay:
    def __init__(self, style: OverlayStyle = OverlayStyle()) -> None:
        self._style = style

    def draw(self, frame_bgr: np.ndarray, quad: np.ndarray, status: ScanStatus) -> np.ndarray:
        """Restituisce una COPIA del frame con overlay (l'originale resta intatto).

        quad: (4, 2) TL, TR, BR, BL in coordinate del frame."""
        out = self._dim_outside(frame_bgr, quad)
        color = self._state_color(status)
        self._draw_corners(out, quad, color)
        self._draw_sharpness_bar(out, quad, status, color)
        self._draw_hud(out, status, color)
        return out

    # --------------------------------------------------------------------- pieces
    def _state_color(self, status: ScanStatus) -> Color:
        if status.quality is None:
            return self._style.neutral
        return self._style.ok if status.quality.passed else self._style.bad

    def _dim_outside(self, frame: np.ndarray, quad: np.ndarray) -> np.ndarray:
        # Scurisce tutto, poi ripristina i pixel originali dentro il poligono (maschera).
        dimmed = cv2.convertScaleAbs(frame, alpha=self._style.dim_factor)
        mask = np.zeros(frame.shape[:2], dtype=np.uint8)
        cv2.fillConvexPoly(mask, np.round(quad).astype(np.int32), 255)
        dimmed[mask > 0] = frame[mask > 0]
        return dimmed

    def _draw_corners(self, img: np.ndarray, quad: np.ndarray, color: Color) -> None:
        """Per ogni angolo, due segmenti lungo i lati adiacenti (seguono l'inclinazione)."""
        t = self._style.corner_thickness
        for i in range(4):
            corner = quad[i]
            for neighbor in (quad[(i + 1) % 4], quad[(i - 1) % 4]):
                end = corner + (neighbor - corner) * self._style.corner_length_ratio
                cv2.line(img, tuple(np.round(corner).astype(int)), tuple(np.round(end).astype(int)),
                         color, t, cv2.LINE_AA)

    def _draw_sharpness_bar(self, img: np.ndarray, quad: np.ndarray, status: ScanStatus, color: Color) -> None:
        """Barra sotto la carta. Scala 0..2*soglia; la tacca centrale e' la soglia."""
        q = status.quality
        if q is None or q.threshold <= 0:
            return
        bar_h, margin = 8, 10
        x0 = int(np.clip(quad[:, 0].min(), 0, img.shape[1] - 2))
        x1 = int(np.clip(quad[:, 0].max(), x0 + 1, img.shape[1] - 1))
        y = int(np.clip(quad[:, 1].max() + margin, 0, img.shape[0] - bar_h - 2))
        cv2.rectangle(img, (x0, y), (x1, y + bar_h), (70, 70, 70), -1)
        fill = int((x1 - x0) * min(q.score / (2.0 * q.threshold), 1.0))
        if fill > 0:
            cv2.rectangle(img, (x0, y), (x0 + fill, y + bar_h), color, -1)
        mid = (x0 + x1) // 2
        cv2.line(img, (mid, y - 3), (mid, y + bar_h + 3), self._style.neutral, 2)

    def _draw_hud(self, img: np.ndarray, status: ScanStatus, color: Color) -> None:
        q = status.quality
        if q is None:
            lines = ["Scontrino non rilevato" if status.frame_index > 0 else "Inquadra lo scontrino"]
        else:
            hint = "OK - scansione in corso" if q.passed else "Sfocato: avvicina / metti a fuoco"
            lines = [
                hint,
                f"Nitidezza {q.score:6.1f} / soglia {q.threshold:.0f}",
                f"Frame accettati {status.accepted}  scartati {status.rejected}",
            ]
        y = 24
        for line in lines:
            # Ombra nera + testo colorato per leggibilita' su qualsiasi sfondo.
            cv2.putText(img, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, self._style.font_scale, (0, 0, 0), 3, cv2.LINE_AA)
            cv2.putText(img, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, self._style.font_scale, color, 1, cv2.LINE_AA)
            y += 24
