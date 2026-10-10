"""Configurazioni immutabili del modulo di scansione (nessuna logica, solo dati)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union


@dataclass(frozen=True)
class CameraConfig:
    """Parametri di acquisizione video.

    source: indice della camera (int) oppure percorso di un file video (str).
            Su mobile reale "camera posteriore" = LENS_FACING_BACK (CameraX/Android)
            o AVCaptureDevice.Position.back (iOS); su desktop e' l'indice del device.
    """

    source: Union[int, str] = 0
    width: int = 1280
    height: int = 720
    fps: int = 30
    backend: int = 0  # 0 == cv2.CAP_ANY (lascia scegliere a OpenCV)
    autofocus: bool = True
    max_read_failures: int = 30  # letture fallite consecutive prima di chiudere il feed

    @property
    def is_file(self) -> bool:
        return isinstance(self.source, str)


@dataclass(frozen=True)
class ScanAreaConfig:
    """Rettangolo di scansione (ROI) centrato nel frame.

    Lo scontrino e' un rettangolo alto e stretto: aspect_ratio = larghezza / altezza.
    Il rettangolo occupa al massimo max_*_ratio del frame, mantenendo l'aspect ratio.
    """

    aspect_ratio: float = 0.6
    max_width_ratio: float = 0.9
    max_height_ratio: float = 0.9


@dataclass(frozen=True)
class BlurFilterConfig:
    """Parametri del filtro di nitidezza (Varianza del Laplaciano)."""

    threshold: float = 100.0
    # La varianza dipende dalla risoluzione: normalizzando la larghezza della ROI
    # la soglia resta confrontabile tra dispositivi diversi. None = nessun resize.
    normalize_width: Optional[int] = 640
