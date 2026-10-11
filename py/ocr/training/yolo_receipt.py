"""Download, prepare, train, evaluate and export a lightweight YOLO segmenter."""
from __future__ import annotations

import argparse
import csv
import random
import shutil
import subprocess
import zipfile
from pathlib import Path
from time import monotonic

import cv2
import numpy as np

from ocr.quality.paper_locator import PaperRegionProvider


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _progress(items, total: int, label: str):
    """Yield items with a dependency-free progress bar."""
    started = monotonic()
    width = 28
    for index, item in enumerate(items, 1):
        elapsed = max(monotonic() - started, 0.001)
        fraction = index / max(total, 1)
        filled = int(width * fraction)
        speed = index / elapsed
        print(
            f"\r[{label}] [{'#' * filled}{'-' * (width - filled)}] "
            f"{index}/{total} ({fraction * 100:5.1f}%) {speed:6.1f}/s",
            end="",
            flush=True,
        )
        yield item
    print(flush=True)


def _images(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)


def _ultralytics():
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "Ultralytics non installato. Esegui: pip install -r ocr\\requirements-training.txt"
        ) from exc
    return YOLO


def _device(value: str) -> str:
    """Map the CLI convenience value ``auto`` to a device Ultralytics accepts."""
    if value != "auto":
        return value
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        backend = "ROCm" if getattr(torch.version, "hip", None) else "CUDA"
        print(f"[hardware] {backend} disponibile: {torch.cuda.get_device_name(0)}", flush=True)
        return "0"
    print("[hardware] PyTorch non vede una GPU accelerata; uso CPU", flush=True)
    return "cpu"


def hardware() -> None:
    try:
        import torch
    except ImportError:
        print("[hardware] PyTorch non installato", flush=True)
        return
    print(f"[hardware] torch={torch.__version__}", flush=True)
    print(f"[hardware] hip={getattr(torch.version, 'hip', None)}", flush=True)
    print(f"[hardware] cuda_available={torch.cuda.is_available()}", flush=True)
    if torch.cuda.is_available():
        print(f"[hardware] device={torch.cuda.get_device_name(0)}", flush=True)
    else:
        print("[hardware] Se hai RX 7800 XT, installa PyTorch ROCm compatibile o usa WSL2 ROCm.", flush=True)


def download(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    print(f"[download] destinazione: {out.resolve()}", flush=True)
    try:
        subprocess.run(
            ["kaggle", "datasets", "download", "-d", "kenvippro/receipt-dataset",
             "-p", str(out), "--force"],
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "Kaggle CLI non trovato. Installa kaggle e configura "
            "%USERPROFILE%\\.kaggle\\kaggle.json."
        ) from exc
    archives = sorted(out.glob("*.zip"))
    if not archives:
        raise RuntimeError(f"Nessun archivio Kaggle trovato in {out}")
    archive = archives[-1]
    extracted = out / "extracted"
    extracted.mkdir(exist_ok=True)
    print(f"[download] estrazione: {archive}", flush=True)
    with zipfile.ZipFile(archive) as zf:
        members = zf.infolist()
        for member in _progress(members, len(members), "extract"):
            zf.extract(member, extracted)
    print(f"[download] immagini trovate: {len(_images(extracted))}", flush=True)


def _find_yaml(source: Path) -> Path | None:
    yamls = list(source.rglob("data.yaml")) + list(source.rglob("dataset.yaml"))
    return yamls[0] if yamls else None


def _find_label(image: Path) -> Path | None:
    for parent in [image.parent, *image.parents]:
        candidate = parent / "labels" / f"{image.stem}.txt"
        if candidate.exists():
            return candidate
    return None


def prepare(source: Path, out: Path, seed: int, val_ratio: float, test_ratio: float) -> None:
    images = [p for p in _images(source) if _find_label(p) is not None]
    if not images:
        yaml = _find_yaml(source)
        raise RuntimeError(
            "Non ho trovato immagini con label YOLO-seg. "
            f"YAML trovato: {yaml}. Il dataset Kaggle potrebbe usare maschere/COCO "
            "e richiede una conversione specifica dopo l'ispezione."
        )
    random.Random(seed).shuffle(images)
    test_count = int(len(images) * test_ratio)
    val_count = int(len(images) * val_ratio)
    groups = {
        "test": images[:test_count],
        "val": images[test_count:test_count + val_count],
        "train": images[test_count + val_count:],
    }
    for split, entries in groups.items():
        for image in _progress(entries, len(entries), f"prepare-{split}"):
            dst_image = out / "images" / split / image.name
            dst_label = out / "labels" / split / f"{image.stem}.txt"
            dst_image.parent.mkdir(parents=True, exist_ok=True)
            dst_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image, dst_image)
            shutil.copy2(_find_label(image), dst_label)
    yaml = out / "data.yaml"
    yaml.write_text(
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: receipt\n"
        "pseudo_labels: true\n"
        "review_status: pending\n",
        encoding="utf-8",
    )
    print(f"[prepare] immagini: {len(images)}; yaml: {yaml}", flush=True)


def prepare_classification(source: Path, out: Path, seed: int, val_ratio: float, test_ratio: float) -> None:
    """Convert Positive/Negative folders to the Ultralytics classification layout."""
    root = source / "extracted" / "Receipt_dataset"
    if not root.exists():
        root = source / "Receipt_dataset"
    classes = {
        "Negative": "negative",
        "Positive": "positive",
    }
    records = [(image, label) for folder, label in classes.items()
               for image in _images(root / folder)]
    if not records:
        raise RuntimeError(f"Cartelle Positive/Negative non trovate sotto {root}")
    random.Random(seed).shuffle(records)
    test_count = int(len(records) * test_ratio)
    val_count = int(len(records) * val_ratio)
    groups = {
        "test": records[:test_count],
        "val": records[test_count:test_count + val_count],
        "train": records[test_count + val_count:],
    }
    for split, entries in groups.items():
        for image, label in _progress(entries, len(entries), f"classify-{split}"):
            target = out / split / label / image.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image, target)
    print(
        f"[prepare-classify] immagini: {len(records)}; "
        f"train={len(groups['train'])}, val={len(groups['val'])}, test={len(groups['test'])}",
        flush=True,
    )


def _dataset_root(source: Path) -> Path:
    root = source / "extracted" / "Receipt_dataset"
    return root if root.exists() else source / "Receipt_dataset"


def _quad_label(image: Path, provider: PaperRegionProvider) -> tuple[str | None, float, str]:
    frame = cv2.imread(str(image), cv2.IMREAD_COLOR)
    if frame is None:
        return None, 0.0, "unreadable"
    region = provider.locate(frame)
    if region is None:
        return None, 0.0, "not_detected"
    height, width = frame.shape[:2]
    points = np.asarray(region.quad, dtype=np.float32)
    values = []
    for x, y in points:
        values.extend((float(np.clip(x / width, 0.0, 1.0)), float(np.clip(y / height, 0.0, 1.0))))
    return "0 " + " ".join(f"{value:.6f}" for value in values), region.confidence, "accepted"


def _read_polygon(label_file: Path, width: int, height: int) -> np.ndarray | None:
    if not label_file.exists():
        return None
    line = label_file.read_text(encoding="utf-8").strip().splitlines()
    if not line:
        return None
    values = line[0].split()[1:]
    if len(values) < 6 or len(values) % 2:
        return None
    points = np.asarray([float(value) for value in values], dtype=np.float32).reshape(-1, 2)
    points[:, 0] *= width
    points[:, 1] *= height
    return points


def annotate_pseudo_segmentation(data: Path, split: str, limit: int = 0) -> None:
    """Correct a selected subset of vertices and mark the dataset reviewed."""
    image_dir = data / "images" / split
    label_dir = data / "labels" / split
    images = _images(image_dir)
    images = [
        image for image in images
        if _read_polygon(label_dir / f"{image.stem}.txt", 1, 1) is not None
    ]
    if limit > 0:
        images = images[:limit]
    if not images:
        raise FileNotFoundError(f"Nessuna immagine trovata: {image_dir}")
    state = {"points": None, "drag": -1}

    def mouse(event, x, y, _flags, _param):
        points = state["points"]
        if points is None:
            return
        if event == cv2.EVENT_LBUTTONDOWN:
            distances = np.linalg.norm(points - np.array([x, y], dtype=np.float32), axis=1)
            nearest = int(np.argmin(distances))
            if distances[nearest] < 30:
                state["drag"] = nearest
        elif event == cv2.EVENT_MOUSEMOVE and state["drag"] >= 0:
            points[state["drag"]] = (x, y)
        elif event == cv2.EVENT_LBUTTONUP:
            state["drag"] = -1

    window = "Receipt mask annotation"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(window, mouse)
    index = 0
    while index < len(images):
        image_path = images[index]
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            index += 1
            continue
        height, width = image.shape[:2]
        loaded = _read_polygon(label_dir / f"{image_path.stem}.txt", width, height)
        state["points"] = loaded.copy() if loaded is not None and len(loaded) == 4 else None
        while True:
            view = image.copy()
            points = state["points"]
            if points is not None:
                polygon = np.round(points).astype(np.int32).reshape(-1, 1, 2)
                overlay = view.copy()
                cv2.fillPoly(overlay, [polygon], (0, 180, 0))
                view = cv2.addWeighted(overlay, 0.28, view, 0.72, 0)
                cv2.polylines(view, [polygon], True, (0, 255, 0), 4, cv2.LINE_AA)
                for point_index, (x, y) in enumerate(np.round(points).astype(np.int32)):
                    cv2.circle(view, (int(x), int(y)), 10, (0, 0, 255), -1, cv2.LINE_AA)
                    cv2.putText(view, str(point_index + 1), (int(x) + 12, int(y) - 12),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2, cv2.LINE_AA)
            cv2.putText(view, f"{index + 1}/{len(images)} drag | a approve | r reject | n skip | q quit",
                        (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv2.LINE_AA)
            cv2.imshow(window, view)
            key = cv2.waitKey(30) & 0xFF
            if key == ord("a") and state["points"] is not None:
                values = []
                for x, y in state["points"]:
                    values.extend((float(np.clip(x / width, 0.0, 1.0)), float(np.clip(y / height, 0.0, 1.0))))
                (label_dir / f"{image_path.stem}.txt").write_text(
                    "0 " + " ".join(f"{value:.6f}" for value in values) + "\n", encoding="utf-8"
                )
                break
            if key == ord("r"):
                (label_dir / f"{image_path.stem}.txt").write_text("", encoding="utf-8")
                break
            if key == ord("n"):
                break
            if key in (ord("q"), 27):
                cv2.destroyAllWindows()
                return
        index += 1
    (data / f"REVIEWED_{split}").write_text("manual_vertex_review_complete\n", encoding="utf-8")
    cv2.destroyAllWindows()
    print(f"[annotate] completato: {data / f'REVIEWED_{split}'}", flush=True)


def review_pseudo_segmentation(data: Path, split: str, save_dir: Path | None, only_positive: bool = True) -> None:
    """Display generated masks and quadrilaterals for manual quality review."""
    image_dir = data / "images" / split
    label_dir = data / "labels" / split
    images = _images(image_dir)
    if only_positive:
        images = [
            image for image in images
            if _read_polygon(label_dir / f"{image.stem}.txt", 1, 1) is not None
        ]
    if not images:
        message = "Nessuna immagine positiva con mask trovata" if only_positive else "Nessuna immagine trovata"
        raise FileNotFoundError(f"{message}: {image_dir}")
    if save_dir is not None:
        save_dir.mkdir(parents=True, exist_ok=True)

    index = 0
    while 0 <= index < len(images):
        image_path = images[index]
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            index += 1
            continue
        height, width = image.shape[:2]
        points = _read_polygon(label_dir / f"{image_path.stem}.txt", width, height)
        view = image.copy()
        if points is not None:
            polygon = np.round(points).astype(np.int32).reshape(-1, 1, 2)
            overlay = view.copy()
            cv2.fillPoly(overlay, [polygon], (0, 180, 0))
            view = cv2.addWeighted(overlay, 0.28, view, 0.72, 0)
            cv2.polylines(view, [polygon], True, (0, 255, 0), 4, cv2.LINE_AA)
            for point_index, (x, y) in enumerate(np.round(points).astype(np.int32)):
                cv2.circle(view, (int(x), int(y)), 8, (0, 0, 255), -1, cv2.LINE_AA)
                cv2.putText(view, str(point_index + 1), (int(x) + 10, int(y) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2, cv2.LINE_AA)
            status = "MASK PRESENT"
        else:
            status = "NO MASK"
        cv2.putText(view, f"{index + 1}/{len(images)} {image_path.name}", (15, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(view, f"{status} | n/space next, p previous, s save, q quit", (15, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2, cv2.LINE_AA)
        if save_dir is not None:
            cv2.imwrite(str(save_dir / image_path.name), view)
        cv2.imshow("YOLO pseudo-mask review", view)
        key = cv2.waitKey(0) & 0xFF
        if key in (ord("q"), 27):
            break
        if key in (ord("n"), ord(" ")):
            index += 1
        elif key == ord("p"):
            index = max(0, index - 1)
        elif key == ord("s") and save_dir is None:
            output = image_path.with_name(f"{image_path.stem}_review.jpg")
            cv2.imwrite(str(output), view)
            print(f"[review] salvata: {output}", flush=True)
    cv2.destroyAllWindows()


def prepare_pseudo_segmentation(
    source: Path,
    out: Path,
    seed: int,
    val_ratio: float,
    test_ratio: float,
    min_confidence: float,
    limit: int,
    include_negative: bool,
) -> None:
    """Create reviewable YOLO-seg pseudo-labels from Positive/Negative images.

    This is a bootstrap dataset, not ground truth. Each positive polygon is
    generated by PaperRegionProvider and recorded in pseudo_labels.csv.
    """
    root = _dataset_root(source)
    for marker in out.glob("REVIEWED*"):
        marker.unlink()
    positives = _images(root / "Positive")
    negatives = _images(root / "Negative") if include_negative else []
    if limit > 0:
        positives = positives[:limit]
        negatives = negatives[: max(1, limit // 2)]
    records = [("positive", image) for image in positives] + [("negative", image) for image in negatives]
    random.Random(seed).shuffle(records)
    test_count = int(len(records) * test_ratio)
    val_count = int(len(records) * val_ratio)
    groups = {
        "test": records[:test_count],
        "val": records[test_count:test_count + val_count],
        "train": records[test_count + val_count:],
    }
    report_rows: list[dict[str, object]] = []
    accepted = rejected = 0
    total = sum(len(entries) for entries in groups.values())
    processed = 0
    for split, entries in groups.items():
        for label, image in _progress(entries, len(entries), f"pseudo-{split}"):
            safe_name = f"{label}_{image.name}"
            dst_image = out / "images" / split / safe_name
            dst_label = out / "labels" / split / f"{Path(safe_name).stem}.txt"
            dst_image.parent.mkdir(parents=True, exist_ok=True)
            dst_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image, dst_image)
            polygon, confidence, status = (None, 0.0, "negative")
            if label == "positive":
                polygon, confidence, status = _quad_label(image, PaperRegionProvider())
                if polygon is None or confidence < min_confidence:
                    rejected += 1
                    status = "rejected_low_confidence" if polygon else status
                    dst_image.unlink()
                    report_rows.append({
                        "split": split, "source": str(image), "confidence": f"{confidence:.4f}", "status": status,
                    })
                    processed += 1
                    continue
                accepted += 1
                dst_label.write_text(polygon + "\n", encoding="utf-8")
            else:
                dst_label.write_text("", encoding="utf-8")
            report_rows.append({
                "split": split, "source": str(image), "confidence": f"{confidence:.4f}", "status": status,
            })
    yaml = out / "data.yaml"
    yaml.write_text(
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: receipt\n"
        "pseudo_labels: true\n"
        "review_status: pending\n",
        encoding="utf-8",
    )
    with (out / "pseudo_labels.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=("split", "source", "confidence", "status"))
        writer.writeheader()
        writer.writerows(report_rows)
    print(
        f"[prepare-pseudo-seg] accepted={accepted}, rejected={rejected}, "
        f"negative={len(negatives)}; review={out / 'pseudo_labels.csv'}",
        flush=True,
    )


def train(data: Path, model: str, project: Path, epochs: int, imgsz: int, batch: int, device: str,
          workers: int, cache: str, amp: bool, allow_pseudo: bool) -> None:
    if not data.exists():
        raise FileNotFoundError(f"Dataset YAML non trovato: {data}")
    yaml_text = data.read_text(encoding="utf-8")
    if "pseudo_labels: true" in yaml_text and not allow_pseudo:
        missing = [split for split in ("train", "val") if not (data.parent / f"REVIEWED_{split}").exists()]
        if missing:
            raise RuntimeError(
                f"Dataset pseudo-label non revisionato per: {', '.join(missing)}. "
                "Esegui annotate-pseudo-seg sugli split richiesti oppure usa "
                "--allow-pseudo solo per un esperimento."
            )
    YOLO = _ultralytics()
    device = _device(device)
    print(f"[train] modello: {model}; data: {data.resolve()}; device: {device}", flush=True)
    YOLO(model).train(
        data=str(data), task="segment", imgsz=imgsz, epochs=epochs, batch=batch,
        device=device, project=str(project), name="receipt_n", pretrained=True,
        patience=30, plots=True, workers=workers, cache=cache, amp=amp,
    )


def train_classification(data: Path, model: str, project: Path, epochs: int, imgsz: int, batch: int, device: str,
                         workers: int, cache: str, amp: bool) -> None:
    if not data.exists():
        raise FileNotFoundError(f"Dataset classification non trovato: {data}")
    YOLO = _ultralytics()
    device = _device(device)
    print(f"[train-classify] modello: {model}; data: {data.resolve()}; device: {device}", flush=True)
    YOLO(model).train(
        data=str(data), task="classify", imgsz=imgsz, epochs=epochs, batch=batch,
        device=device, project=str(project), name="receipt_cls_n", pretrained=True,
        patience=30, plots=True, workers=workers, cache=cache, amp=amp,
    )


def test(weights: Path, data: Path, imgsz: int, device: str) -> None:
    if not weights.exists():
        raise FileNotFoundError(f"Pesi non trovati: {weights}")
    YOLO = _ultralytics()
    device = _device(device)
    if "pseudo_labels: true" in data.read_text(encoding="utf-8") and not (data.parent / "REVIEWED_test").exists():
        raise RuntimeError(
            "Il test pseudo-label non è marcato come revisionato. "
            "Revisiona lo split test oppure non usarlo come metrica finale."
        )
    print(f"[test] pesi: {weights.resolve()}; data: {data.resolve()}; device: {device}", flush=True)
    metrics = YOLO(str(weights)).val(data=str(data), imgsz=imgsz, device=device, plots=True)
    print("[test] metriche:", metrics.results_dict, flush=True)


def export(weights: Path, fmt: str, imgsz: int, int8: bool) -> None:
    if not weights.exists():
        raise FileNotFoundError(f"Pesi non trovati: {weights}")
    YOLO = _ultralytics()
    print(f"[export] formato: {fmt}; int8: {int8}", flush=True)
    result = YOLO(str(weights)).export(format=fmt, imgsz=imgsz, int8=int8)
    print(f"[export] completato: {result}", flush=True)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Training YOLO-seg per scontrini")
    sub = p.add_subparsers(dest="command", required=True)
    d = sub.add_parser("download")
    d.add_argument("--out", type=Path, required=True)
    r = sub.add_parser("prepare")
    r.add_argument("--source", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--seed", type=int, default=42)
    r.add_argument("--val-ratio", type=float, default=0.2)
    r.add_argument("--test-ratio", type=float, default=0.1)
    c = sub.add_parser("prepare-classify")
    c.add_argument("--source", type=Path, required=True)
    c.add_argument("--out", type=Path, required=True)
    c.add_argument("--seed", type=int, default=42)
    c.add_argument("--val-ratio", type=float, default=0.2)
    c.add_argument("--test-ratio", type=float, default=0.1)
    ps = sub.add_parser("prepare-pseudo-seg")
    ps.add_argument("--source", type=Path, required=True)
    ps.add_argument("--out", type=Path, required=True)
    ps.add_argument("--seed", type=int, default=42)
    ps.add_argument("--val-ratio", type=float, default=0.2)
    ps.add_argument("--test-ratio", type=float, default=0.1)
    ps.add_argument("--min-confidence", type=float, default=0.55)
    ps.add_argument("--limit", type=int, default=0, help="0 = tutte le immagini")
    ps.add_argument("--no-negative", action="store_true")
    rv = sub.add_parser("review-pseudo-seg", help="Mostra maschere e quadrilateri")
    rv.add_argument("--data", type=Path, required=True)
    rv.add_argument("--split", choices=("train", "val", "test"), default="val")
    rv.add_argument("--save-dir", type=Path, default=None)
    rv.add_argument("--include-empty", action="store_true", help="Include anche immagini senza mask")
    an = sub.add_parser("annotate-pseudo-seg", help="Corregge e approva i quattro vertici")
    an.add_argument("--data", type=Path, required=True)
    an.add_argument("--split", choices=("train", "val", "test"), default="train")
    an.add_argument("--limit", type=int, default=0, help="0 = tutte le mask positive")
    t = sub.add_parser("train")
    t.add_argument("--data", type=Path, required=True)
    t.add_argument("--model", default="yolo11n-seg.pt")
    t.add_argument("--out", type=Path, default=Path("runs/segment"))
    t.add_argument("--epochs", type=int, default=100)
    t.add_argument("--imgsz", type=int, default=640)
    t.add_argument("--batch", type=int, default=-1)
    t.add_argument("--device", default="auto")
    t.add_argument("--workers", type=int, default=8)
    t.add_argument("--cache", choices=("False", "ram", "disk"), default="disk")
    t.add_argument("--no-amp", action="store_true")
    t.add_argument("--allow-pseudo", action="store_true")
    tc = sub.add_parser("train-classify")
    tc.add_argument("--data", type=Path, required=True)
    tc.add_argument("--model", default="yolo11n-cls.pt")
    tc.add_argument("--out", type=Path, default=Path("runs"))
    tc.add_argument("--epochs", type=int, default=50)
    tc.add_argument("--imgsz", type=int, default=224)
    tc.add_argument("--batch", type=int, default=-1)
    tc.add_argument("--device", default="auto")
    tc.add_argument("--workers", type=int, default=8)
    tc.add_argument("--cache", choices=("False", "ram", "disk"), default="disk")
    tc.add_argument("--no-amp", action="store_true")
    h = sub.add_parser("hardware", help="Mostra backend PyTorch e GPU rilevata")
    e = sub.add_parser("test")
    e.add_argument("--weights", type=Path, required=True)
    e.add_argument("--data", type=Path, required=True)
    e.add_argument("--imgsz", type=int, default=640)
    e.add_argument("--device", default="auto")
    x = sub.add_parser("export")
    x.add_argument("--weights", type=Path, required=True)
    x.add_argument("--format", choices=("tflite", "ncnn", "onnx", "coreml"), default="tflite")
    x.add_argument("--imgsz", type=int, default=640)
    x.add_argument("--int8", action="store_true")
    return p


def main() -> int:
    args = parser().parse_args()
    if args.command == "download":
        download(args.out)
    elif args.command == "prepare":
        prepare(args.source, args.out, args.seed, args.val_ratio, args.test_ratio)
    elif args.command == "prepare-classify":
        prepare_classification(args.source, args.out, args.seed, args.val_ratio, args.test_ratio)
    elif args.command == "prepare-pseudo-seg":
        prepare_pseudo_segmentation(
            args.source, args.out, args.seed, args.val_ratio, args.test_ratio,
            args.min_confidence, args.limit, not args.no_negative,
        )
    elif args.command == "review-pseudo-seg":
        review_pseudo_segmentation(args.data, args.split, args.save_dir, not args.include_empty)
    elif args.command == "annotate-pseudo-seg":
        annotate_pseudo_segmentation(args.data, args.split, args.limit)
    elif args.command == "train":
        train(args.data, args.model, args.out, args.epochs, args.imgsz, args.batch, args.device,
              args.workers, False if args.cache == "False" else args.cache, not args.no_amp, args.allow_pseudo)
    elif args.command == "train-classify":
        train_classification(args.data, args.model, args.out, args.epochs, args.imgsz, args.batch, args.device,
                             args.workers, False if args.cache == "False" else args.cache, not args.no_amp)
    elif args.command == "test":
        test(args.weights, args.data, args.imgsz, args.device)
    elif args.command == "export":
        export(args.weights, args.format, args.imgsz, args.int8)
    elif args.command == "hardware":
        hardware()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())