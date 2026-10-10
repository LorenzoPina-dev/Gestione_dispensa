"""Porte (interfacce) del dominio. Le implementazioni concrete vivono negli altri strati
e dipendono da queste, mai il contrario (Dependency Inversion)."""
from __future__ import annotations

from typing import Optional, Protocol

import numpy as np

from ocr.domain.models import Frame, QualityResult, ScanRegion


class RegionProvider(Protocol):
    """Individua lo scontrino nel frame e ne restituisce quadrilatero + immagine raddrizzata.
    None = non trovato (il frame viene scartato)."""

    def locate(self, image_bgr: np.ndarray) -> Optional[ScanRegion]: ...


class FrameSource(Protocol):
    """Sorgente di frame (camera, file video, ...)."""

    def start(self) -> None: ...

    def stop(self) -> None: ...


class QualityFilter(Protocol):
    """Valuta la qualita' di un'immagine (BGR o scala di grigi)."""

    def evaluate(self, image: np.ndarray) -> QualityResult: ...


class PatchEnhancer(Protocol):
    """Migliora il patch raddrizzato per l'OCR (colore, luce, contrasto). Stessa shape in uscita."""

    def enhance(self, patch_bgr: np.ndarray) -> np.ndarray: ...


class FrameConsumer(Protocol):
    """Riceve solo i frame che hanno superato il filtro qualita', con la regione raddrizzata."""

    def on_frame(self, frame: Frame, region: ScanRegion) -> None: ...
