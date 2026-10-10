"""Text Detection con DBNet (TFLite INT8). Implementa la porta `TextDetector`."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import cv2
import numpy as np

from ocr.domain.ocr_models import TextBox
from ocr.inference.db_postprocess import DBConfig, DBPostProcessor
from ocr.inference.tflite_model import TfliteModel, channels_and_size, detect_layout


@dataclass(frozen=True)
class DetectorConfig:
    # Normalizzazione ImageNet (standard per DBNet): x' = (x/255 - mean) / std, canali RGB.
    mean: Tuple[float, float, float] = (0.485, 0.456, 0.406)
    std: Tuple[float, float, float] = (0.229, 0.224, 0.225)
    max_side: int = 960  # usato solo se il modello ha input dinamico
    db: DBConfig = DBConfig()


class DbNetDetector:
    def __init__(self, model: TfliteModel, config: DetectorConfig = DetectorConfig()) -> None:
        self._model = model
        self._cfg = config
        self._post = DBPostProcessor(config.db)
        self._mean = np.array(config.mean, dtype=np.float32)
        self._std = np.array(config.std, dtype=np.float32)

    def detect(self, image_bgr: np.ndarray) -> List[TextBox]:
        orig_h, orig_w = image_bgr.shape[:2]
        shape = self._model.input_shape
        layout = detect_layout(shape)
        target_h, target_w = self._target_size(orig_h, orig_w)

        tensor = self._preprocess(image_bgr, target_h, target_w, layout)
        prob = self._to_probability_map(self._model.run(tensor))
        return self._post.boxes_from_probability(prob, orig_w, orig_h)

    # --------------------------------------------------------------------- helpers
    def _target_size(self, orig_h: int, orig_w: int) -> Tuple[int, int]:
        """Modello a input fisso: usa (H, W) del modello.
        Modello dinamico: lato massimo = max_side, lati arrotondati a multipli di 32
        (la rete riduce la risoluzione di 32x e poi la ricostruisce)."""
        if not self._model.input_dynamic:
            _, h, w = channels_and_size(self._model.input_shape)
            return h, w
        scale = min(1.0, self._cfg.max_side / float(max(orig_h, orig_w)))
        h = max(32, int(round(orig_h * scale / 32.0)) * 32)
        w = max(32, int(round(orig_w * scale / 32.0)) * 32)
        return h, w

    def _preprocess(self, image_bgr: np.ndarray, th: int, tw: int, layout: str) -> np.ndarray:
        h, w = image_bgr.shape[:2]
        interpolation = cv2.INTER_AREA if (tw < w or th < h) else cv2.INTER_LINEAR
        resized = cv2.resize(image_bgr, (tw, th), interpolation=interpolation)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        normalized = (rgb - self._mean) / self._std
        if layout == "NCHW":
            normalized = normalized.transpose(2, 0, 1)
        return normalized[np.newaxis, ...]

    @staticmethod
    def _to_probability_map(output: np.ndarray) -> np.ndarray:
        prob = np.squeeze(output)
        if prob.ndim != 2:
            raise ValueError(f"Output DBNet inatteso: shape {output.shape} (attesa mappa 2D dopo squeeze)")
        return np.clip(prob, 0.0, 1.0)
