from __future__ import annotations

import re

from ocr.document_ai.models import OCRResult, StructuredReceipt


def structure_receipt(result: OCRResult) -> StructuredReceipt:
    lines = list(result.lines) or result.text.splitlines()
    total = None
    for line in reversed(lines):
        if re.search(r"\b(?:totale|total|importo pagato|da pagare)\b", line, re.I):
            match = re.search(r"-?\d+[,.]\d{2}", line)
            if match:
                total = match.group(0)
                break
    merchant = next((line.strip() for line in lines[:5] if re.search(r"[A-Za-zÀ-ÿ]{3}", line)), None)
    warnings = () if result.confidence >= 0.7 else ("low_ocr_confidence",)
    return StructuredReceipt(merchant=merchant, total=total, warnings=warnings)
