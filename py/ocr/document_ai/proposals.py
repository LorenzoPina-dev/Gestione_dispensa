from __future__ import annotations

from typing import Protocol

import numpy as np

from ocr.document_ai.models import CandidateRegion
from ocr.quality.paper_locator import PaperRegionProvider


class LearnedDetector(Protocol):
    def propose(self, image_bgr: np.ndarray) -> list[CandidateRegion]: ...


def propose_regions(image: np.ndarray, locator: PaperRegionProvider,
                     learned: LearnedDetector | None = None) -> list[CandidateRegion]:
    """Cascata: detector appreso opzionale, poi baseline OpenCV esistente."""
    proposals = learned.propose(image) if learned is not None else []
    region = locator.locate(image)
    if region is not None:
        proposals.append(CandidateRegion(
            quad=region.quad.copy(),
            mask=None,
            source="opencv-paper-locator",
            scores={"detector": region.confidence},
        ))
    return proposals
