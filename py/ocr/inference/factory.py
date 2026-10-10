"""Factory: unico punto che istanzia le implementazioni TFLite concrete."""
from __future__ import annotations

from typing import Optional

from ocr.inference.ctc_decoder import DEFAULT_CHARSET, load_charset
from ocr.inference.ocr_engine import OcrEngine
from ocr.inference.text_detector import DbNetDetector
from ocr.inference.text_recognizer import CrnnRecognizer, RecognizerConfig
from ocr.inference.tflite_model import TfliteModel


def build_tflite_engine(
    detector_path: str,
    recognizer_path: str,
    charset_path: Optional[str] = None,
    num_threads: int = 2,
) -> OcrEngine:
    charset = load_charset(charset_path) if charset_path else DEFAULT_CHARSET
    detector = DbNetDetector(TfliteModel(detector_path, num_threads=num_threads))
    recognizer = CrnnRecognizer(
        TfliteModel(recognizer_path, num_threads=num_threads),
        RecognizerConfig(charset=charset),
    )
    return OcrEngine(detector, recognizer)
