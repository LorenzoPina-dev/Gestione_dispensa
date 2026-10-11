"""Pipeline document-AI indipendente dal backend OCR e dal detector appreso."""

from ocr.document_ai.models import PipelineResult, ReceiptInstance
from ocr.document_ai.pipeline import ReceiptPipeline

__all__ = ["PipelineResult", "ReceiptInstance", "ReceiptPipeline"]
