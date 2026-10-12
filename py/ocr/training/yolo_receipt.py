"""Download, prepare, train, evaluate and export a lightweight YOLO segmenter."""
from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
import subprocess
import zipfile
from pathlib import Path
from time import monotonic

import cv2
import numpy as np

from ocr.quality.enhance import ReceiptEnhancer
from ocr.quality.paper_locator import PaperRegionProvider
from ocr.quality.paper_locator import order_quad, rectify
from ocr.merging.fuzzy_receipt import FuzzyReceiptAccumulator
from ocr.parsing.receipt_parser import ReceiptParser


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


def _review_manifest_path(data: Path, split: str) -> Path:
    return data / f"reviewed_{split}.txt"


def _record_reviewed_image(data: Path, split: str, image: Path) -> None:
    manifest = _review_manifest_path(data, split)
    relative = image.resolve().relative_to(data.resolve()).as_posix()
    existing = set()
    if manifest.exists():
        existing = {line.strip() for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()}
    if relative not in existing:
        with manifest.open("a", encoding="utf-8") as handle:
            handle.write(relative + "\n")


def _reviewed_data_yaml(data: Path, required_splits: tuple[str, ...]) -> Path:
    manifests: dict[str, str] = {}
    for split in required_splits:
        manifest = _review_manifest_path(data, split)
        if not manifest.exists():
            raise RuntimeError(f"Manifest mancante per '{split}': {manifest}")
        entries = [line.strip() for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not entries:
            raise RuntimeError(f"Nessuna immagine revisionata nello split '{split}'")
        missing = [entry for entry in entries if not (data / entry).exists()]
        if missing:
            raise RuntimeError(f"Immagine mancante nel manifest {manifest}: {missing[0]}")
        manifests[split] = manifest.name
    yaml = data / "data.reviewed.yaml"
    yaml.write_text(
        f"path: {data.resolve().as_posix()}\n"
        f"train: {manifests.get('train', 'reviewed_train.txt')}\n"
        f"val: {manifests.get('val', 'reviewed_val.txt')}\n"
        f"test: {manifests.get('test', 'reviewed_test.txt')}\n"
        "names:\n  0: receipt\npseudo_labels: true\nreview_status: partial_or_complete\n",
        encoding="utf-8",
    )
    return yaml


def annotate_pseudo_segmentation(data: Path, split: str, limit: int = 0, prefix: str = "") -> None:
    """Correct a selected subset of vertices and mark the dataset reviewed."""
    image_dir = data / "images" / split
    label_dir = data / "labels" / split
    images = _images(image_dir)
    images = [
        image for image in images
        if (not prefix or image.name.startswith(prefix))
        and _read_polygon(label_dir / f"{image.stem}.txt", 1, 1) is not None
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
            if key == ord("s"):
                export_dir = data / "review_exports" / split
                export_dir.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(export_dir / f"{image_path.stem}_review.jpg"), view)
                print(f"[annotate] overlay salvato: {export_dir / f'{image_path.stem}_review.jpg'}", flush=True)
                continue
            if key == ord("a") and state["points"] is not None:
                values = []
                for x, y in state["points"]:
                    values.extend((float(np.clip(x / width, 0.0, 1.0)), float(np.clip(y / height, 0.0, 1.0))))
                (label_dir / f"{image_path.stem}.txt").write_text(
                    "0 " + " ".join(f"{value:.6f}" for value in values) + "\n", encoding="utf-8"
                )
                _record_reviewed_image(data, split, image_path)
                break
            if key == ord("r"):
                (label_dir / f"{image_path.stem}.txt").write_text("", encoding="utf-8")
                _record_reviewed_image(data, split, image_path)
                break
            if key == ord("n"):
                break
            if key in (ord("q"), 27):
                cv2.destroyAllWindows()
                return
        index += 1
    if limit <= 0 and not prefix:
        (data / f"REVIEWED_{split}").write_text("manual_vertex_review_complete\n", encoding="utf-8")
    cv2.destroyAllWindows()
    print(f"[annotate] manifest: {_review_manifest_path(data, split)}", flush=True)


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


def _mask_to_polygon(mask_file: Path) -> str | None:
    mask = cv2.imread(str(mask_file), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        return None
    contours, _ = cv2.findContours((mask > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 100:
        return None
    rect = cv2.minAreaRect(contour)
    points = cv2.boxPoints(rect).astype(np.float32)
    center = points.mean(axis=0)
    angles = np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0])
    points = points[np.argsort(angles)]
    height, width = mask.shape[:2]
    values = []
    for x, y in points:
        values.extend((float(np.clip(x / width, 0.0, 1.0)), float(np.clip(y / height, 0.0, 1.0))))
    return "0 " + " ".join(f"{value:.6f}" for value in values)


def import_predictions(predictions: Path, data: Path, split: str, prefix: str) -> None:
    """Import positive prediction masks as an unreviewed active-learning batch."""
    originals = predictions / "originals"
    masks = predictions / "masks"
    if not originals.exists() or not masks.exists():
        siblings = sorted(
            candidate.name
            for candidate in predictions.parent.glob(f"{predictions.name}*")
            if candidate.is_dir()
        )
        available = f" Cartelle simili: {', '.join(siblings)}." if siblings else ""
        raise FileNotFoundError(
            f"Output predizioni incompleto o inesistente: {predictions}. "
            f"Servono le sottocartelle 'originals' e 'masks'.{available} "
            "Esegui prima predict-seg sullo split desiderato."
        )
    mask_files = sorted(masks.glob("*_mask.png"))
    if not mask_files:
        raise FileNotFoundError(f"Nessuna mask predetta trovata in {masks}")
    image_dir = data / "images" / split
    label_dir = data / "labels" / split
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    imported = skipped = 0
    for mask_file in _progress(mask_files, len(mask_files), "import-predictions"):
        stem = mask_file.name[:-len("_mask.png")]
        candidates = sorted(originals.glob(stem + ".*"))
        polygon = _mask_to_polygon(mask_file)
        if not candidates or polygon is None:
            skipped += 1
            continue
        source_image = candidates[0]
        target_name = f"{prefix}{source_image.name}"
        target_image = image_dir / target_name
        target_label = label_dir / f"{Path(target_name).stem}.txt"
        if target_image.exists() or target_label.exists():
            skipped += 1
            continue
        shutil.copy2(source_image, target_image)
        target_label.write_text(polygon + "\n", encoding="utf-8")
        imported += 1
    print(f"[import-predictions] importate={imported}, saltate={skipped}; split={split}", flush=True)


def train(data: Path, model: str, project: Path, epochs: int, imgsz: int, batch: int, device: str,
          workers: int, cache: str, amp: bool, allow_pseudo: bool) -> None:
    if not data.exists():
        raise FileNotFoundError(f"Dataset YAML non trovato: {data}")
    yaml_text = data.read_text(encoding="utf-8")
    has_review_metadata = (
        "pseudo_labels: true" in yaml_text
        or any(data.parent.glob("reviewed_*.txt"))
        or any(data.parent.glob("REVIEWED_*"))
    )
    if not allow_pseudo and has_review_metadata:
        data = _reviewed_data_yaml(data.parent, ("train", "val"))
    elif not allow_pseudo and data.parent.name.endswith("_pseudo"):
        raise RuntimeError(
            f"Dataset pseudo senza manifest di revisione: {data.parent}. "
            "Esegui annotate-pseudo-seg su train e val oppure usa --allow-pseudo."
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
    if "pseudo_labels: true" in data.read_text(encoding="utf-8"):
        data = _reviewed_data_yaml(data.parent, ("test",))
    print(f"[test] pesi: {weights.resolve()}; data: {data.resolve()}; device: {device}", flush=True)
    metrics = YOLO(str(weights)).val(data=str(data), split="test", imgsz=imgsz, device=device, plots=True)
    print("[test] metriche:", metrics.results_dict, flush=True)


def predict_segmentation(weights: Path, source: Path, out: Path, imgsz: int, device: str, confidence: float) -> None:
    """Save originals, overlays and binary masks for positive predictions."""
    if not weights.exists():
        raise FileNotFoundError(f"Pesi non trovati: {weights}")
    images = [source] if source.is_file() else _images(source)
    if not images:
        raise FileNotFoundError(f"Nessuna immagine trovata in: {source}")
    YOLO = _ultralytics()
    device = _device(device)
    originals = out / "originals"
    overlays = out / "overlays"
    masks = out / "masks"
    for folder in (originals, overlays, masks):
        folder.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(weights))
    rows: list[dict[str, object]] = []
    positive_images = 0
    detections = 0
    for image_path in _progress(images, len(images), "predict"):
        results = model.predict(
            source=str(image_path), imgsz=imgsz, conf=confidence, device=device,
            verbose=False, retina_masks=True,
        )
        if not results or results[0].masks is None:
            continue
        result = results[0]
        original = result.orig_img
        if original is None:
            continue
        height, width = original.shape[:2]
        combined = np.zeros((height, width), dtype=np.uint8)
        overlay = original.copy()
        count = 0
        for index, mask in enumerate(result.masks.data.cpu().numpy()):
            binary = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST) > 0.5
            if not np.any(binary):
                continue
            combined[binary] = 255
            colored = np.zeros_like(original)
            colored[:] = (40, 210, 40)
            overlay[binary] = cv2.addWeighted(original[binary], 0.55, colored[binary], 0.45, 0)
            contours, _ = cv2.findContours(binary.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, (0, 255, 0), 3, cv2.LINE_AA)
            confidence_value = float(result.boxes.conf[index].item())
            rows.append({"image": str(image_path), "detection": index,
                         "confidence": f"{confidence_value:.6f}",
                         "mask_pixels": int(np.count_nonzero(binary))})
            count += 1
            detections += 1
        if count:
            positive_images += 1
            shutil.copy2(image_path, originals / image_path.name)
            cv2.imwrite(str(overlays / f"{image_path.stem}_overlay.jpg"), overlay)
            cv2.imwrite(str(masks / f"{image_path.stem}_mask.png"), combined)
    with (out / "predictions.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=("image", "detection", "confidence", "mask_pixels"))
        writer.writeheader()
        writer.writerows(rows)
    print(f"[predict-seg] immagini positive: {positive_images}/{len(images)}; mask: {detections}; risultati: {out.resolve()}", flush=True)


def _video_source(value: str) -> int | str:
    return int(value) if value.isdigit() else value


def _draw_segmentation_overlay(frame: np.ndarray, result, confidence: float) -> tuple[np.ndarray, int]:
    shown = frame.copy()
    if result.masks is None or result.boxes is None:
        return shown, 0
    height, width = frame.shape[:2]
    count = 0
    for index, mask in enumerate(result.masks.data.cpu().numpy()):
        binary = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST) > 0.5
        score = float(result.boxes.conf[index].item())
        if score < confidence or not np.any(binary):
            continue
        color = (40, 210, 40) if index % 2 == 0 else (40, 180, 255)
        color_layer = np.zeros_like(frame)
        color_layer[:] = color
        shown[binary] = cv2.addWeighted(frame[binary], 0.55, color_layer[binary], 0.45, 0)
        contours, _ = cv2.findContours(
            binary.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        cv2.drawContours(shown, contours, -1, color, 3, cv2.LINE_AA)
        count += 1
    return shown, count


def _quad_from_mask(binary: np.ndarray) -> np.ndarray | None:
    contours, _ = cv2.findContours(
        binary.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    perimeter = cv2.arcLength(contour, True)
    polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True).reshape(-1, 2)
    if len(polygon) != 4 or cv2.contourArea(polygon.astype(np.float32)) <= 0:
        polygon = cv2.boxPoints(cv2.minAreaRect(contour)).astype(np.float32)
    return order_quad(np.asarray(polygon, dtype=np.float32))


def _make_binary(enhanced: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    return cv2.morphologyEx(
        binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    )


def _fit_stage_view(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)


def _show_receipt_stages(
    frame: np.ndarray,
    overlay: np.ndarray,
    mask: np.ndarray,
    rectified: np.ndarray,
    enhanced: np.ndarray,
    binary: np.ndarray,
    lines: list[str],
) -> None:
    panel_w, panel_h = 420, 300
    stages = [
        ("1 frame + mask", overlay),
        ("2 mask", mask),
        ("3 rettificato", rectified),
        ("4 contrasto uniforme", enhanced),
        ("5 binarizzato OCR", binary),
    ]
    tiles = []
    for title, image in stages:
        tile = _fit_stage_view(image, (panel_w, panel_h))
        cv2.rectangle(tile, (0, 0), (panel_w - 1, panel_h - 1), (0, 220, 255), 2)
        cv2.putText(tile, title, (10, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.65,
                    (0, 220, 255), 2, cv2.LINE_AA)
        tiles.append(tile)
    top = np.hstack(tiles[:3])
    bottom = np.hstack(tiles[3:] + [np.zeros_like(tiles[0])])
    board = np.vstack([top, bottom])
    cv2.putText(board, "OCR: " + " | ".join(lines[:5]), (10, board.shape[0] - 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2, cv2.LINE_AA)
    cv2.imshow("YOLO receipt stages", board)


def segment_video(
    weights: Path,
    source: int | str,
    imgsz: int,
    device: str,
    confidence: float,
    blur_threshold: float,
    motion_threshold: float,
    infer_every: int,
    warmup_frames: int,
    output: Path | None,
    display_width: int,
    det_model: str | None,
    rec_model: str | None,
    charset: str | None,
    threads: int,
    paddleocr: bool,
    paddle_lang: str,
    document_out: Path,
) -> None:
    """Run segmentation only on sharp, temporally stable video frames."""
    if not weights.exists():
        raise FileNotFoundError(f"Pesi non trovati: {weights}")
    if infer_every < 1:
        raise ValueError("--infer-every deve essere >= 1")
    if warmup_frames < 0:
        raise ValueError("--warmup-frames deve essere >= 0")
    if blur_threshold < 0 or motion_threshold < 0:
        raise ValueError("Le soglie blur/motion devono essere >= 0")

    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        raise RuntimeError(f"Impossibile aprire la sorgente video: {source}")
    writer = None
    if output is not None and isinstance(source, str):
        output.parent.mkdir(parents=True, exist_ok=True)
        fps = capture.get(cv2.CAP_PROP_FPS)
        fps = fps if fps > 0 else 25.0
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        writer = cv2.VideoWriter(
            str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height)
        )
        if not writer.isOpened():
            capture.release()
            raise RuntimeError(f"Impossibile creare il video di output: {output}")

    YOLO = _ultralytics()
    device = _device(device)
    model = YOLO(str(weights))
    ocr_engine = None
    if paddleocr and (det_model or rec_model):
        raise ValueError("Scegli un solo backend OCR: --paddleocr oppure --det-model/--rec-model")
    if paddleocr:
        from ocr.inference.paddle_backend import PaddleOcrLineReader
        ocr_engine = PaddleOcrLineReader(lang=paddle_lang, device="cpu", min_confidence=0.0)
    if det_model or rec_model:
        if not det_model or not rec_model:
            raise ValueError("--det-model e --rec-model devono essere indicati insieme")
        missing = [
            path for path in (det_model, rec_model, charset)
            if path is not None and not Path(path).is_file()
        ]
        if missing:
            raise FileNotFoundError(
                "File OCR non trovati: " + ", ".join(missing) +
                ". Usa percorsi esistenti oppure ometti --det-model e --rec-model "
                "per visualizzare solo gli step di segmentazione/preprocessing."
            )
        from ocr.inference.factory import build_tflite_engine
        ocr_engine = build_tflite_engine(det_model, rec_model, charset, threads)
    enhancer = ReceiptEnhancer()
    previous_small = None
    last_overlay = None
    frame_index = 0
    inferred = 0
    accepted = 0
    receipt_lines = FuzzyReceiptAccumulator()
    window = "YOLO receipt segmentation"
    print(
        f"[video-seg] source={source}; device={device}; blur>={blur_threshold}; "
        f"motion<={motion_threshold}; infer-every={infer_every}",
        flush=True,
    )
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            frame_index += 1
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            motion_score = 0.0
            small = cv2.resize(gray, (160, 90), interpolation=cv2.INTER_AREA)
            small = cv2.GaussianBlur(small, (5, 5), 0)
            if previous_small is not None:
                motion_score = float(cv2.absdiff(small, previous_small).mean())
            previous_small = small
            blur_ok = blur_score >= blur_threshold
            motion_ok = motion_score <= motion_threshold
            stable = frame_index <= warmup_frames or (blur_ok and motion_ok)
            shown = frame.copy()
            status = f"frame {frame_index} blur={blur_score:.1f} motion={motion_score:.1f}"

            if stable and frame_index % infer_every == 0:
                result = model.predict(
                    source=frame, imgsz=imgsz, conf=confidence, device=device,
                    verbose=False, retina_masks=True,
                )[0]
                inferred += 1
                last_overlay, count = _draw_segmentation_overlay(frame, result, confidence)
                if count:
                    accepted += 1
                    best_index = max(
                        range(len(result.masks.data)),
                        key=lambda index: float(result.boxes.conf[index].item()),
                    )
                    best_mask = cv2.resize(
                        result.masks.data[best_index].cpu().numpy(),
                        (frame.shape[1], frame.shape[0]),
                        interpolation=cv2.INTER_NEAREST,
                    ) > 0.5
                    quad = _quad_from_mask(best_mask)
                    if quad is not None:
                        rectified = rectify(frame, quad, max_side=1600)
                        if rectified is not None:
                            enhanced = enhancer.enhance_adaptive(rectified)
                            binary = _make_binary(enhanced)
                            lines = ocr_engine.read_lines(enhanced) if ocr_engine else []
                            texts = [line.text for line in lines]
                            if texts:
                                receipt_lines.update(texts, frame_index)
                            _show_receipt_stages(
                                frame, last_overlay, (best_mask * 255).astype(np.uint8),
                                rectified, enhanced, binary, texts,
                            )
                shown = last_overlay
                status += f" | inferenza: {count} mask"
            elif last_overlay is not None and stable:
                shown = last_overlay.copy()
                status += " | mask precedente"
            else:
                reason = []
                if not blur_ok:
                    reason.append("blur")
                if not motion_ok:
                    reason.append("motion")
                status += " | frame scartato:" + "+".join(reason)

            cv2.putText(shown, status, (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65,
                        (0, 255, 255), 2, cv2.LINE_AA)
            output_frame = shown
            if display_width > 0 and shown.shape[1] > display_width:
                scale = display_width / float(shown.shape[1])
                shown = cv2.resize(shown, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            cv2.imshow(window, shown)
            if writer is not None:
                writer.write(output_frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
    finally:
        capture.release()
        if writer is not None:
            writer.release()
        cv2.destroyAllWindows()
    _save_document(document_out, receipt_lines.snapshot(), receipt_lines.evidence())
    print(
        f"[video-seg] frame={frame_index}; inferenze={inferred}; "
        f"frame con mask={accepted}",
        flush=True,
    )


def _save_document(path: Path, lines: list[str], evidence: list[dict]) -> None:
    parsed = ReceiptParser().parse(lines)
    payload = {
        "lines": lines,
        "evidence": evidence,
        "items": [
            {
                "name": item.name,
                "price": str(item.price),
                "quantity": item.quantity,
                "unit_price": str(item.unit_price) if item.unit_price is not None else None,
                "raw_line": item.raw_line,
            }
            for item in parsed.items
        ],
        "total": str(parsed.total) if parsed.total is not None else None,
        "total_line": parsed.total_line,
        "items_sum": str(parsed.items_sum),
        "consistent": parsed.is_consistent(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[video-seg] documento salvato: {path}", flush=True)


def ocr_image(image: Path, lang: str, device: str, min_confidence: float) -> None:
    """Esegue PaddleOCR su una singola immagine e stampa righe e parsing."""
    from ocr.inference.paddle_backend import PaddleOcrLineReader
    from ocr.parsing.receipt_parser import ReceiptParser

    if not image.is_file():
        raise FileNotFoundError(f"Immagine non trovata: {image}")
    lines = PaddleOcrLineReader(
        lang=lang, device=device, min_confidence=min_confidence
    ).read_lines(cv2.imread(str(image)))
    texts = [line.text for line in lines]
    parsed = ReceiptParser().parse(texts)
    print("\n".join(texts))
    print(
        f"[ocr-image] righe={len(lines)} articoli={len(parsed.items)} "
        f"totale={parsed.total if parsed.total is not None else 'n/d'} "
        f"coerente={parsed.is_consistent()}"
    )


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
    an.add_argument("--prefix", default="", help="Revisiona solo immagini con questo prefisso")
    ip = sub.add_parser("import-predictions", help="Importa predizioni positive come batch non revisionato")
    ip.add_argument("--predictions", type=Path, required=True)
    ip.add_argument("--data", type=Path, required=True)
    ip.add_argument("--split", choices=("train", "val", "test"), default="train")
    ip.add_argument("--prefix", default="pred_", help="Prefisso per evitare collisioni con immagini esistenti")
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
    pr = sub.add_parser("predict-seg", help="Salva originali, overlay e mask positive")
    pr.add_argument("--weights", type=Path, required=True)
    pr.add_argument("--source", type=Path, required=True)
    pr.add_argument("--out", type=Path, required=True)
    pr.add_argument("--imgsz", type=int, default=640)
    pr.add_argument("--device", default="auto")
    pr.add_argument("--conf", type=float, default=0.25)
    vs = sub.add_parser("video-seg", help="Segmenta solo frame nitidi e temporalmente stabili")
    vs.add_argument("--weights", type=Path, required=True)
    vs.add_argument("--source", type=_video_source, default=0, help="indice camera o file video")
    vs.add_argument("--imgsz", type=int, default=512)
    vs.add_argument("--device", default="auto")
    vs.add_argument("--conf", type=float, default=0.25)
    vs.add_argument("--blur-threshold", type=float, default=80.0)
    vs.add_argument("--motion-threshold", type=float, default=8.0)
    vs.add_argument("--infer-every", type=int, default=3)
    vs.add_argument("--warmup-frames", type=int, default=5)
    vs.add_argument("--output", type=Path, default=None, help="video MP4 di output, solo per file video")
    vs.add_argument("--display-width", type=int, default=1280)
    vs.add_argument("--det-model", default=None, help="modello DBNet TFLite per OCR")
    vs.add_argument("--rec-model", default=None, help="modello CRNN TFLite per OCR")
    vs.add_argument("--charset", default=None, help="charset CRNN")
    vs.add_argument("--threads", type=int, default=2)
    vs.add_argument("--paddleocr", action="store_true", help="usa PaddleOCR al posto di TFLite")
    vs.add_argument("--paddle-lang", default="en", help="lingua PaddleOCR, ad esempio it o en")
    vs.add_argument("--document-out", type=Path, default=Path("receipt_document.json"),
                    help="JSON finale con righe, articoli, totale ed evidenze frame")
    oi = sub.add_parser("ocr-image", help="Esegue PaddleOCR su una singola immagine")
    oi.add_argument("--image", type=Path, required=True)
    oi.add_argument("--lang", default="en")
    oi.add_argument("--device", default="cpu")
    oi.add_argument("--min-confidence", type=float, default=0.0)
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
        annotate_pseudo_segmentation(args.data, args.split, args.limit, args.prefix)
    elif args.command == "import-predictions":
        import_predictions(args.predictions, args.data, args.split, args.prefix)
    elif args.command == "train":
        train(args.data, args.model, args.out, args.epochs, args.imgsz, args.batch, args.device,
              args.workers, False if args.cache == "False" else args.cache, not args.no_amp, args.allow_pseudo)
    elif args.command == "train-classify":
        train_classification(args.data, args.model, args.out, args.epochs, args.imgsz, args.batch, args.device,
                             args.workers, False if args.cache == "False" else args.cache, not args.no_amp)
    elif args.command == "test":
        test(args.weights, args.data, args.imgsz, args.device)
    elif args.command == "predict-seg":
        predict_segmentation(args.weights, args.source, args.out, args.imgsz, args.device, args.conf)
    elif args.command == "video-seg":
        segment_video(
            args.weights, args.source, args.imgsz, args.device, args.conf,
            args.blur_threshold, args.motion_threshold, args.infer_every,
            args.warmup_frames, args.output, args.display_width,
            args.det_model, args.rec_model, args.charset, args.threads,
            args.paddleocr, args.paddle_lang, args.document_out,
        )
    elif args.command == "ocr-image":
        ocr_image(args.image, args.lang, args.device, args.min_confidence)
    elif args.command == "export":
        export(args.weights, args.format, args.imgsz, args.int8)
    elif args.command == "hardware":
        hardware()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
