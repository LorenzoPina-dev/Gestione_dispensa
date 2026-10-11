"""Calibrazione interattiva del localizzatore senza modelli OCR.

Avvio dalla cartella ``py``:
    python -m ocr.debug_ui --source ocr\f.mp4
"""
from __future__ import annotations

import argparse
from dataclasses import replace
from typing import Callable, Dict, Union

import cv2
import numpy as np

from ocr.quality.paper_locator import PaperLocatorConfig, PaperRegionProvider


WINDOW = "Receipt locator tuning"
CONTROL = "Parameters"


def _source(value: str) -> Union[int, str]:
    return int(value) if value.isdigit() else value


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calibrazione interattiva del localizzatore")
    parser.add_argument("--source", type=_source, default=0, help="indice camera o file video")
    parser.add_argument("--display-width", type=int, default=1200)
    return parser.parse_args()


class TuningUi:
    def __init__(self, capture: cv2.VideoCapture, display_width: int) -> None:
        self.capture = capture
        self.display_width = display_width
        self.paused = False
        self.frame: np.ndarray | None = None
        self.config = PaperLocatorConfig()
        self.provider = PaperRegionProvider(self.config, video_mode=True)
        self.controls: Dict[str, tuple[int, int, Callable[[int], object]]] = {}
        cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
        cv2.namedWindow(CONTROL, cv2.WINDOW_NORMAL)
        self._add("text contrast", 1, 60, lambda x: float(x))
        self._add("stroke kernel", 3, 25, lambda x: float(x if x % 2 else x + 1))
        self._add("seed area %", 0, 10, lambda x: x / 100.0)
        self._add("merge width", 3, 40, lambda x: float(x))
        self._add("merge height", 3, 30, lambda x: float(x))
        self._add("chroma tol", 1, 30, lambda x: float(x))
        self._add("luminance low %", 20, 100, lambda x: x / 100.0)
        self._add("luminance high %", 100, 220, lambda x: x / 100.0)
        self._add("fallback width %", 0, 100, lambda x: x / 100.0)
        self._add("fallback height %", 0, 100, lambda x: x / 100.0)
        self._sync_from_config()

    def _add(self, title: str, initial: int, maximum: int, convert: Callable[[int], object]) -> None:
        cv2.createTrackbar(title, CONTROL, initial, maximum, self._changed)
        self.controls[title] = (initial, maximum, convert)

    def _sync_from_config(self) -> None:
        values = {
            "text contrast": self.config.min_text_contrast,
            "stroke kernel": self.config.stroke_kernel,
            "seed area %": self.config.min_seed_area_ratio * 100,
            "merge width": self.config.text_merge_width,
            "merge height": self.config.text_merge_height,
            "chroma tol": self.config.chroma_tolerance,
            "luminance low %": self.config.luminance_ratio * 100,
            "luminance high %": self.config.luminance_ratio_high * 100,
            "fallback width %": self.config.seed_fallback_width * 100,
            "fallback height %": self.config.seed_fallback_height * 100,
        }
        for title, value in values.items():
            cv2.setTrackbarPos(title, CONTROL, int(round(value)))

    def _changed(self, _: int) -> None:
        if self.frame is None:
            return
        values = {name: cv2.getTrackbarPos(name, CONTROL) for name in self.controls}
        kernel = max(3, values["stroke kernel"] | 1)
        config = replace(
            self.config,
            min_text_contrast=float(values["text contrast"]),
            stroke_kernel=kernel,
            min_seed_area_ratio=values["seed area %"] / 100.0,
            text_merge_width=max(3, values["merge width"]),
            text_merge_height=max(3, values["merge height"]),
            chroma_tolerance=float(values["chroma tol"]),
            luminance_ratio=values["luminance low %"] / 100.0,
            luminance_ratio_high=values["luminance high %"] / 100.0,
            seed_fallback_width=values["fallback width %"] / 100.0,
            seed_fallback_height=values["fallback height %"] / 100.0,
        )
        self.provider = PaperRegionProvider(config, video_mode=True)
        self._draw()

    def _draw(self) -> None:
        if self.frame is None:
            return
        region = self.provider.locate(self.frame)
        diagnostic = self.provider.debug_image(self.frame, None if region is None else region.quad)
        if region is None:
            cv2.putText(diagnostic, "NO RECEIPT", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
        else:
            cv2.putText(
                diagnostic,
                f"confidence {region.confidence:.2f}",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 255, 0),
                2,
            )
        height, width = diagnostic.shape[:2]
        if width > self.display_width:
            diagnostic = cv2.resize(
                diagnostic,
                None,
                fx=self.display_width / width,
                fy=self.display_width / width,
                interpolation=cv2.INTER_AREA,
            )
        cv2.imshow(WINDOW, diagnostic)

    def run(self) -> int:
        while True:
            if not self.paused:
                ok, frame = self.capture.read()
                if not ok:
                    self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ok, frame = self.capture.read()
                if ok:
                    self.frame = frame
                    self._draw()
            key = cv2.waitKey(30 if not self.paused else 0) & 0xFF
            if key in (ord("q"), 27):
                return 0
            if key == ord(" "):
                self.paused = not self.paused
                continue
            if key == ord("n") and self.paused:
                ok, frame = self.capture.read()
                if ok:
                    self.frame = frame
                    self._draw()
        return 0


def main() -> int:
    args = _args()
    capture = cv2.VideoCapture(args.source)
    if not capture.isOpened():
        raise RuntimeError(f"Impossibile aprire la sorgente: {args.source}")
    try:
        return TuningUi(capture, args.display_width).run()
    finally:
        capture.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    raise SystemExit(main())
