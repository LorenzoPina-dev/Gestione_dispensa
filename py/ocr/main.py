"""Entry point / composition root: qui (e solo qui) si assemblano le dipendenze.

Esecuzione consigliata (dalla cartella `py/`):
    python -m ocr.main --source f.mp4 --threshold 100 --debug-dir ocr_debug
    python -m ocr.main --det-model det.tflite --rec-model rec.tflite [--charset dict.txt]

Funziona anche da dentro `py/ocr/`:   python main.py --source f.mp4

Tasti:  p = stampa lo scontrino letto finora   r = azzera   q / ESC = esci
"""
from __future__ import annotations

import os
import sys

# Avvio come script (`python main.py`) o con `python -m main`: il pacchetto `ocr` vive nella
# cartella superiore, quindi la aggiungiamo al path prima degli import del progetto.
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse  # noqa: E402
import logging  # noqa: E402
from typing import List, Union  # noqa: E402

import cv2  # noqa: E402

from ocr.camera.camera_feed import CameraError, CameraFeed  # noqa: E402
from ocr.config import BlurFilterConfig, CameraConfig, ScanAreaConfig  # noqa: E402
from ocr.domain.geometry import ScanAreaGeometry  # noqa: E402
from ocr.domain.ports import FrameConsumer, RegionProvider  # noqa: E402
from ocr.merging.accumulator import ReceiptAccumulator  # noqa: E402
from ocr.parsing.receipt_parser import ReceiptParser  # noqa: E402
from ocr.pipeline.consumers import CompositeConsumer, SaveCropsConsumer  # noqa: E402
from ocr.pipeline.ocr_consumer import OcrFrameConsumer  # noqa: E402
from ocr.pipeline.scan_session import ScanSession  # noqa: E402
from ocr.pipeline.status_board import StatusBoard  # noqa: E402
from ocr.quality.blur_filter import LaplacianBlurFilter  # noqa: E402
from ocr.quality.enhance import ReceiptEnhancer  # noqa: E402
from ocr.quality.paper_locator import PaperRegionProvider  # noqa: E402
from ocr.ui.scan_overlay import ScanOverlay  # noqa: E402

WINDOW = "Receipt scanner"


def _parse_source(value: str) -> Union[int, str]:
    return int(value) if value.isdigit() else value


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scansione continua scontrini")
    p.add_argument("--source", type=_parse_source, default=0, help="indice camera o file video")
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--height", type=int, default=720)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--threshold", type=float, default=100.0, help="soglia Varianza del Laplaciano")
    p.add_argument("--locate", choices=("paper", "fixed"), default="paper",
                   help="paper = segue la carta bianca nel frame; fixed = riquadro centrato fisso")
    p.add_argument("--display-width", type=int, default=1280, help="larghezza massima della finestra")
    p.add_argument("--debug-dir", type=str, default=None, help="salva ritagli accettati in questa cartella")
    p.add_argument("--det-model", type=str, default=None, help="DBNet .tflite (INT8)")
    p.add_argument("--rec-model", type=str, default=None, help="CRNN .tflite (INT8)")
    p.add_argument("--charset", type=str, default=None, help="dizionario CRNN, un carattere per riga")
    p.add_argument("--threads", type=int, default=2, help="thread di inferenza TFLite")
    p.add_argument("--no-enhance", action="store_true",
                   help="non migliorare (colore/luce/contrasto) il patch dato all'OCR; utile per confronti")
    return p.parse_args()


def _print_receipt(accumulator: ReceiptAccumulator, parser: ReceiptParser) -> None:
    lines = accumulator.snapshot()
    receipt = parser.parse(lines)
    print("\n" + "=" * 60)
    print(f"Righe lette: {len(lines)}")
    for line in lines:
        print(f"  | {line}")
    print("-" * 60)
    for item in receipt.items:
        qty = f"{item.quantity} x " if item.quantity > 1 else ""
        print(f"  {qty}{item.name:<38} {item.price:>8}")
    print("-" * 60)
    print(f"  Somma articoli: {receipt.items_sum}")
    print(f"  Totale:         {receipt.total if receipt.total is not None else 'non trovato'}")
    if receipt.total is not None:
        print(f"  Coerente:       {'si' if receipt.is_consistent() else 'NO (controlla le righe)'}")
    print("=" * 60 + "\n")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = _parse_args()

    camera_cfg = CameraConfig(source=args.source, width=args.width, height=args.height, fps=args.fps)
    fixed_area = ScanAreaGeometry(ScanAreaConfig())
    enhancer = ReceiptEnhancer()  # bilanciamento colore / riflessi / contrasto: scena e patch OCR
    roi_provider: RegionProvider = (
        PaperRegionProvider(enhancer=enhancer) if args.locate == "paper" else fixed_area
    )
    quality_filter = LaplacianBlurFilter(BlurFilterConfig(threshold=args.threshold))
    status_board = StatusBoard()
    overlay = ScanOverlay()
    accumulator = ReceiptAccumulator()
    parser = ReceiptParser()

    consumers: List[FrameConsumer] = []
    if args.debug_dir:
        consumers.append(SaveCropsConsumer(args.debug_dir))
    if args.det_model and args.rec_model:
        # Import locale: senza modelli il runtime TFLite non e' richiesto.
        from ocr.inference.factory import build_tflite_engine

        engine = build_tflite_engine(args.det_model, args.rec_model, args.charset, args.threads)
        consumers.append(OcrFrameConsumer(engine, accumulator))
    else:
        logging.warning("Modelli OCR non indicati: attivo solo preview, localizzazione e filtro di nitidezza.")

    feed = CameraFeed(camera_cfg)
    session = ScanSession(
        buffer=feed.buffer,
        roi_provider=roi_provider,
        quality_filter=quality_filter,
        consumer=CompositeConsumer(consumers),
        status_board=status_board,
        patch_enhancer=None if args.no_enhance else enhancer,
    )

    try:
        feed.start()
    except CameraError as exc:
        logging.error("%s", exc)
        return 1
    session.start()

    # Il main thread e' il "UI thread": solo preview + overlay, mai elaborazione pesante.
    last_drawn = 0
    try:
        while True:
            frame = feed.buffer.latest()
            if frame is not None and frame.index != last_drawn:
                last_drawn = frame.index
                status = status_board.snapshot()
                h, w = frame.image.shape[:2]
                quad = status.quad if status.quad is not None else fixed_area.compute_roi(w, h).corners()
                shown = overlay.draw(frame.image, quad, status)
                if w > args.display_width:
                    scale = args.display_width / float(w)
                    shown = cv2.resize(shown, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                cv2.imshow(WINDOW, shown)

            key = cv2.waitKey(5) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("p"):
                _print_receipt(accumulator, parser)
            elif key == ord("r"):
                accumulator.reset()
                logging.info("Scontrino azzerato.")

            if feed.buffer.closed and not feed.is_running:
                # Fine del file video: lascia finire l'ultimo frame, poi riepiloga.
                session.join(timeout=60.0)
                final = status_board.snapshot()
                logging.info(
                    "Video terminato: %d frame accettati, %d scartati.", final.accepted, final.rejected
                )
                if args.det_model and args.rec_model:
                    _print_receipt(accumulator, parser)
                break
    finally:
        session.stop()
        feed.stop()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
