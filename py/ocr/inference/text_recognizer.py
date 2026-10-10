"""Text Recognition con CRNN (TFLite INT8). Implementa la porta `TextRecognizer`."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence

import cv2
import numpy as np

from ocr.domain.ocr_models import Recognition
from ocr.inference.ctc_decoder import DEFAULT_CHARSET, build_classes, ctc_greedy_decode, softmax
from ocr.inference.tflite_model import TfliteModel, channels_and_size, detect_layout


@dataclass(frozen=True)
class RecognizerConfig:
    charset: str = DEFAULT_CHARSET
    blank_first: bool = True  # PaddleOCR/CRNN tipici: blank = indice 0
    # Normalizzazione: x' = (x/255 - mean) / std  -> con 0.5/0.5 il range diventa [-1, 1].
    mean: float = 0.5
    std: float = 0.5
    apply_softmax: bool = True  # False se il modello emette gia' probabilita'
    max_dynamic_width: int = 640  # solo per modelli con larghezza dinamica


class CrnnRecognizer:
    def __init__(self, model: TfliteModel, config: RecognizerConfig = RecognizerConfig()) -> None:
        self._model = model
        self._cfg = config
        self._classes = build_classes(config.charset, config.blank_first)
        self._blank_index = 0 if config.blank_first else len(self._classes) - 1

        shape = model.input_shape
        self._layout = detect_layout(shape)
        self._channels, self._height, self._fixed_width = channels_and_size(shape)
        if self._channels not in (1, 3):
            raise ValueError(f"Canali input non supportati: {self._channels}")

    def recognize(self, crops_bgr: Sequence[np.ndarray]) -> List[Recognition]:
        return [self._recognize_one(crop) for crop in crops_bgr]

    # ---------------------------------------------------------------------- core
    def _recognize_one(self, crop: np.ndarray) -> Recognition:
        if crop is None or crop.size == 0:
            return Recognition(text="", confidence=0.0)

        tensor = self._preprocess(crop)
        output = self._model.run(tensor)
        probs = self._to_time_by_class(output)
        if self._cfg.apply_softmax:
            probs = softmax(probs, axis=1)
        return ctc_greedy_decode(probs, self._classes, self._blank_index)

    def _preprocess(self, crop_bgr: np.ndarray) -> np.ndarray:
        """Resize a altezza fissa mantenendo l'aspect ratio, poi padding a destra.

        w_resized = min(W_max, ceil(H * w / h))
        Il padding e' 0 DOPO la normalizzazione (cioe' il "grigio medio"), cosi' non
        introduce bordi artificiali che la rete potrebbe leggere come caratteri.
        """
        h, w = crop_bgr.shape[:2]
        canvas_w = self._fixed_width if not self._model.input_dynamic else self._cfg.max_dynamic_width
        resized_w = max(1, min(canvas_w, int(math.ceil(self._height * w / float(h)))))
        resized = cv2.resize(crop_bgr, (resized_w, self._height), interpolation=cv2.INTER_CUBIC)

        if self._channels == 1:
            image = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)[..., np.newaxis]
        else:
            image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        normalized = (image.astype(np.float32) / 255.0 - self._cfg.mean) / self._cfg.std

        if self._model.input_dynamic:
            canvas_w = int(math.ceil(resized_w / 8.0) * 8)  # multiplo di 8 (stride della rete)
        canvas = np.zeros((self._height, canvas_w, self._channels), dtype=np.float32)
        canvas[:, :resized_w, :] = normalized

        if self._layout == "NCHW":
            canvas = canvas.transpose(2, 0, 1)
        return canvas[np.newaxis, ...]

    def _to_time_by_class(self, output: np.ndarray) -> np.ndarray:
        """Normalizza l'output a (T, num_classes), gestendo (1,T,C) e (1,C,T)."""
        out = np.squeeze(output, axis=0) if output.ndim == 3 and output.shape[0] == 1 else output
        if out.ndim != 2:
            raise ValueError(f"Output CRNN inatteso: shape {output.shape}")
        num_classes = len(self._classes)
        if out.shape[1] != num_classes and out.shape[0] == num_classes:
            out = out.T
        if out.shape[1] != num_classes:
            raise ValueError(
                f"Il modello emette {out.shape[1]} classi ma il charset ne definisce {num_classes} "
                f"(charset + blank). Usa --charset con il dizionario corretto."
            )
        return out
