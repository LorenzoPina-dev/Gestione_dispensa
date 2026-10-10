"""OcrEngine: detection -> raggruppamento in righe -> recognition."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

import numpy as np

from ocr.domain.ocr_models import OcrLine, TextBox
from ocr.domain.ocr_ports import TextDetector, TextRecognizer
from ocr.inference.cropping import crop_text_region


@dataclass(frozen=True)
class OcrEngineConfig:
    min_confidence: float = 0.5  # sotto questa soglia il segmento e' scartato (rumore)
    same_line_ratio: float = 0.5  # |dy| < ratio * altezza => stessa riga
    max_boxes: int = 150


class OcrEngine:
    """Implementa la porta `LineReader`. Dipende solo da astrazioni (DIP)."""

    def __init__(
        self,
        detector: TextDetector,
        recognizer: TextRecognizer,
        config: OcrEngineConfig = OcrEngineConfig(),
    ) -> None:
        self._detector = detector
        self._recognizer = recognizer
        self._cfg = config

    def read_lines(self, image_bgr: np.ndarray) -> List[OcrLine]:
        boxes = self._detector.detect(image_bgr)
        if not boxes:
            return []
        boxes = sorted(boxes, key=lambda b: b.score, reverse=True)[: self._cfg.max_boxes]

        groups = self._group_into_lines(boxes)
        ordered = [box for group in groups for box in group]  # ordine di lettura
        crops = [crop_text_region(image_bgr, box.points) for box in ordered]
        recognitions = self._recognizer.recognize(crops)

        by_box = {id(box): rec for box, rec in zip(ordered, recognitions)}
        lines: List[OcrLine] = []
        for group in groups:
            segments = []
            for box in group:
                rec = by_box[id(box)]
                if rec.text.strip() and rec.confidence >= self._cfg.min_confidence:
                    segments.append((box, rec))
            if not segments:
                continue
            lines.append(
                OcrLine(
                    text=" ".join(rec.text.strip() for _, rec in segments),
                    confidence=float(np.mean([rec.confidence for _, rec in segments])),
                    y_center=float(np.mean([box.center_y for box, _ in segments])),
                    x_min=min(box.x_min for box, _ in segments),
                    x_max=max(box.x_max for box, _ in segments),
                )
            )
        return lines

    def _group_into_lines(self, boxes: List[TextBox]) -> List[List[TextBox]]:
        """Raggruppa i box con centro verticale vicino (es. nome prodotto a sinistra e
        prezzo a destra sono due box sulla stessa riga). Ogni gruppo e' ordinato per x."""
        groups: List[List[TextBox]] = []
        for box in sorted(boxes, key=lambda b: b.center_y):
            if groups:
                current = groups[-1]
                group_cy = float(np.mean([b.center_y for b in current]))
                group_h = float(np.mean([b.height for b in current]))
                if abs(box.center_y - group_cy) <= self._cfg.same_line_ratio * max(group_h, box.height):
                    current.append(box)
                    continue
            groups.append([box])
        for group in groups:
            group.sort(key=lambda b: b.x_min)
        return groups
