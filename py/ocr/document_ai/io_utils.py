from __future__ import annotations

from pathlib import Path
from typing import Union

import cv2
import numpy as np


def load_image(source: Union[str, Path, np.ndarray]) -> np.ndarray:
    """Carica una BGR uint8 valida; non scarica o converte implicitamente altro."""
    if isinstance(source, np.ndarray):
        image = source.copy()
    else:
        image = cv2.imread(str(source), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Immagine non leggibile: {source}")
    if image.ndim != 3 or image.shape[2] != 3 or image.size == 0:
        raise ValueError("Attesa immagine BGR non vuota con tre canali")
    if image.dtype != np.uint8:
        image = np.clip(image, 0, 255).astype(np.uint8)
    return image


def save_debug(image: np.ndarray, path: Union[str, Path]) -> str:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), image):
        raise OSError(f"Impossibile salvare il debug artifact: {destination}")
    return str(destination)
