"""Geometria dell'area di scansione. Condivisa da overlay (disegno) e pipeline (ritaglio),
cosi' l'utente vede esattamente la regione che viene analizzata."""
from __future__ import annotations

from ocr.config import ScanAreaConfig
from ocr.domain.models import Rect, ScanRegion


class ScanAreaGeometry:
    def __init__(self, config: ScanAreaConfig) -> None:
        if config.aspect_ratio <= 0:
            raise ValueError("aspect_ratio deve essere > 0")
        self._config = config

    def compute_roi(self, frame_width: int, frame_height: int) -> Rect:
        """Rettangolo centrato con aspect ratio fisso (larghezza / altezza).

        Parte dall'altezza massima; se la larghezza risultante supera il massimo
        consentito, si ricalcola partendo dalla larghezza (caso frame verticali).
        """
        cfg = self._config
        height = frame_height * cfg.max_height_ratio
        width = height * cfg.aspect_ratio
        max_width = frame_width * cfg.max_width_ratio
        if width > max_width:
            width = max_width
            height = width / cfg.aspect_ratio

        w = max(1, int(round(width)))
        h = max(1, int(round(height)))
        x = (frame_width - w) // 2
        y = (frame_height - h) // 2
        return Rect(x=x, y=y, width=w, height=h)

    def locate(self, image_bgr) -> ScanRegion:
        """Porta `RegionProvider`: area fissa centrata, indipendente dal contenuto del frame."""
        height, width = image_bgr.shape[:2]
        roi = self.compute_roi(width, height)
        return ScanRegion(quad=roi.corners(), patch=roi.crop(image_bgr))
