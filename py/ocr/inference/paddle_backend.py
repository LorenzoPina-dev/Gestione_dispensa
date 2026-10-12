"""Backend opzionale PaddleOCR -> righe OCR del dominio."""
from __future__ import annotations

from typing import Any, List

import cv2
import numpy as np

from ocr.domain.ocr_models import OcrLine


class PaddleOcrLineReader:
    """Adatta l'API PaddleOCR 3.x alla porta `LineReader`."""

    def __init__(
        self,
        lang: str = "en",
        device: str = "cpu",
        min_confidence: float = 0.0,
    ) -> None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise RuntimeError(
                "PaddleOCR non disponibile. Installa paddleocr e paddlepaddle "
                "nell'ambiente Python attivo."
            ) from exc
        if not 0.0 <= min_confidence <= 1.0:
            raise ValueError("min_confidence deve essere compresa tra 0 e 1")
        self._min_confidence = min_confidence
        self._ocr = PaddleOCR(
            lang=lang,
            device=device,
            enable_mkldnn=False,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def read_lines(self, image_bgr: np.ndarray) -> List[OcrLine]:
        if image_bgr.size == 0:
            return []
        if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
            raise ValueError("PaddleOCR richiede un'immagine BGR a 3 canali")

        results = self._ocr.predict(input=image_bgr)
        if results is None:
            return []
        result = next(iter(results), None)
        if result is None:
            return []

        texts = _field(result, "rec_texts", default=[])
        scores = _field(result, "rec_scores", default=[])
        polygons = _field(result, "dt_polys", default=[])
        detected: list[tuple[str, float, np.ndarray]] = []
        for text, score, polygon in zip(texts, scores, polygons):
            text = str(text).strip()
            confidence = float(score)
            points = np.asarray(polygon, dtype=np.float32)
            if not text or confidence < self._min_confidence or points.size < 8:
                continue
            points = points.reshape(-1, 2)
            detected.append((text, confidence, points))
        if not detected:
            return []
        heights = [
            float(points[:, 1].max() - points[:, 1].min())
            for _, _, points in detected
        ]
        same_line_tolerance = max(3.0, float(np.median(heights) * 0.35))
        groups: list[list[tuple[str, float, np.ndarray]]] = []
        for item in sorted(detected, key=lambda value: float(value[2][:, 1].mean())):
            center_y = float(item[2][:, 1].mean())
            if groups:
                previous_y = float(np.mean([part[2][:, 1].mean() for part in groups[-1]]))
                if abs(center_y - previous_y) <= same_line_tolerance:
                    groups[-1].append(item)
                    continue
            groups.append([item])
        lines: list[OcrLine] = []
        for group in groups:
            group.sort(key=lambda value: float(value[2][:, 0].min()))
            lines.append(
                OcrLine(
                    text=" ".join(value[0] for value in group),
                    confidence=float(np.mean([value[1] for value in group])),
                    y_center=float(np.mean([value[2][:, 1].mean() for value in group])),
                    x_min=min(float(value[2][:, 0].min()) for value in group),
                    x_max=max(float(value[2][:, 0].max()) for value in group),
                )
            )
        lines.sort(key=lambda line: (line.y_center, line.x_min))
        return lines


def _field(result: Any, name: str, default: Any) -> Any:
    """Legge sia il risultato dict-like sia l'oggetto risultato PaddleX."""
    if isinstance(result, dict):
        return result.get(name, default)
    try:
        return result[name]
    except (KeyError, IndexError, TypeError):
        return getattr(result, name, default)


def read_paddle_image(
    image_path: str,
    lang: str = "en",
    device: str = "cpu",
    min_confidence: float = 0.0,
) -> list[OcrLine]:
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Immagine non leggibile: {image_path}")
    return PaddleOcrLineReader(lang, device, min_confidence).read_lines(image)
