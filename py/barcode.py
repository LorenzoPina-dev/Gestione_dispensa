import os

# Imposta la variabile d'ambiente per AMD RX 7800 XT PRIMA di importare PyTorch
os.environ['HSA_OVERRIDE_GFX_VERSION'] = '11.0.0'

import json
from pathlib import Path
import shutil
import cv2
import numpy as np
from pyzbar import pyzbar
import torch
from ultralytics import YOLO

# ------------------------------------------------------------------------------
# 1. CONVERSIONE E PREPARAZIONE DATASET (POSI-COMPATIBILE)
# ------------------------------------------------------------------------------


def convert_coco_to_yolo(
    coco_json_path, images_dir, output_img_dir, output_label_dir
):
  if not os.path.exists(coco_json_path):
    print(f'[!] File non trovato: {coco_json_path}')
    return

  with open(coco_json_path, 'r', encoding='utf-8') as f:
    coco_data = json.load(f)

  os.makedirs(output_img_dir, exist_ok=True)
  os.makedirs(output_label_dir, exist_ok=True)

  images = {img['id']: img for img in coco_data['images']}
  categories = {
      cat['id']: idx for idx, cat in enumerate(coco_data['categories'])
  }

  img_to_anns = {}
  for ann in coco_data.get('annotations', []):
    img_id = ann['image_id']
    img_to_anns.setdefault(img_id, []).append(ann)

  print(f'[*] Convertendo {len(images)} immagini da COCO a YOLO...')

  for img_id, img_info in images.items():
    file_name = img_info['file_name']
    img_w = img_info['width']
    img_h = img_info['height']

    src_img_path = os.path.join(images_dir, file_name)
    dst_img_path = os.path.join(output_img_dir, file_name)

    if os.path.exists(src_img_path) and not os.path.exists(dst_img_path):
      shutil.copy(src_img_path, dst_img_path)

    label_filename = Path(file_name).stem + '.txt'
    label_filepath = os.path.join(output_label_dir, label_filename)

    if os.path.exists(label_filepath):
      continue

    anns = img_to_anns.get(img_id, [])
    with open(label_filepath, 'w', encoding='utf-8') as f_out:
      for ann in anns:
        cat_id = ann['category_id']
        class_id = categories.get(cat_id, 0)

        bbox = ann['bbox']
        x_min, y_min, bw, bh = bbox[0], bbox[1], bbox[2], bbox[3]

        x_center = (x_min + bw / 2.0) / img_w
        y_center = (y_min + bh / 2.0) / img_h
        norm_w = bw / img_w
        norm_h = bh / img_h

        x_center = max(0.0, min(1.0, x_center))
        y_center = max(0.0, min(1.0, y_center))
        norm_w = max(0.0, min(1.0, norm_w))
        norm_h = max(0.0, min(1.0, norm_h))

        f_out.write(
            f'{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f}'
            f' {norm_h:.6f}\n'
        )

  print(f'[✓] Conversione completata per {output_img_dir}')


def prepare_dataset_structure(
    dataset_root='datasets/barcode_dataset',
):
  target_dir = Path('./yolo_barcode_dataset').resolve()
  yaml_path = target_dir / 'data.yaml'

  # Se esiste un data.yaml creato da Windows, rimuovilo per evitare conflitti
  if yaml_path.exists():
    with open(yaml_path, 'r', encoding='utf-8') as f:
      content = f.read()
    if 'D:' in content or '\\' in content:
      print(
          '[*] Rilevati percorsi di Windows in data.yaml. Rigenerazione in'
          ' corso...'
      )
      yaml_path.unlink()

  if yaml_path.exists():
    print(
        f'[✓] Dataset YOLO già presente in: {target_dir}. Conversione'
        ' saltata.'
    )
    return str(yaml_path)

  os.makedirs(target_dir / 'images/train', exist_ok=True)
  os.makedirs(target_dir / 'images/val', exist_ok=True)
  os.makedirs(target_dir / 'labels/train', exist_ok=True)
  os.makedirs(target_dir / 'labels/val', exist_ok=True)

  convert_coco_to_yolo(
      coco_json_path=os.path.join(
          dataset_root, 'train', '_annotations.coco.json'
      ),
      images_dir=os.path.join(dataset_root, 'train'),
      output_img_dir=str(target_dir / 'images/train'),
      output_label_dir=str(target_dir / 'labels/train'),
  )

  convert_coco_to_yolo(
      coco_json_path=os.path.join(
          dataset_root, 'val', '_annotations.coco.json'
      ),
      images_dir=os.path.join(dataset_root, 'val'),
      output_img_dir=str(target_dir / 'images/val'),
      output_label_dir=str(target_dir / 'labels/val'),
  )

  yaml_content = f"""path: {target_dir.as_posix()}
train: images/train
val: images/val

names:
  0: barcode
"""
  with open(yaml_path, 'w', encoding='utf-8') as f:
    f.write(yaml_content)

  print(f'[✓] File data.yaml creato in: {yaml_path}')
  return str(yaml_path)


# ------------------------------------------------------------------------------
# 2. ADDESTRAMENTO MODELLO YOLOV8 (ROCm / AMD GPU)
# ------------------------------------------------------------------------------


def train_yolo_model(yaml_path):
  print('[*] Inizializzazione modello YOLOv8-Nano...')
  model = YOLO('yolov8n.pt')

  # In PyTorch ROCm le GPU AMD vengono mappate attraverso l'interfaccia 'cuda'
  gpu_available = torch.cuda.is_available()
  device = 0 if gpu_available else 'cpu'

  if gpu_available:
    print(f'[*] GPU AMD Rilevata: {torch.cuda.get_device_name(0)}')
  else:
    print('[!] GPU AMD non rilevata da PyTorch. Controllo fallback su CPU.')

  results = model.train(
      data=yaml_path,
      epochs=50,
      imgsz=640,
      batch=32,  # Sfrutta i 16 GB di VRAM della RX 7800 XT
      workers=8,
      cache=True,
      device=device,
      project='barcode_detection_run',
      name='yolov8n_barcode_amd',
      degrees=15.0,
      perspective=0.0005,
      scale=0.5,
      hsv_h=0.015,
      hsv_s=0.7,
      hsv_v=0.4,
      mosaic=1.0,
      mixup=0.1,
      save=True,
  )
  print('[✓] Addestramento completato!')
  return model


# ------------------------------------------------------------------------------
# 3. DECODER
# ------------------------------------------------------------------------------


def validate_ean13_checksum(code_str):
  if len(code_str) not in (12, 13) or not code_str.isdigit():
    return True
  if len(code_str) == 12:
    code_str = '0' + code_str
  digits = [int(c) for c in code_str]
  checksum = digits[-1]
  total = sum(digits[i] if i % 2 == 0 else digits[i] * 3 for i in range(12))
  calculated = (10 - (total % 10)) % 10
  return checksum == calculated


def decode_barcode_crop(crop_img):
  gray = (
      cv2.cvtColor(crop_img, cv2.COLOR_BGR2GRAY)
      if len(crop_img.shape) == 3
      else crop_img
  )
  clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
  enhanced = clahe.apply(gray)
  _, thresh_otsu = cv2.threshold(
      enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
  )

  candidates = [crop_img, gray, enhanced, thresh_otsu]

  for candidate in candidates:
    barcodes = pyzbar.decode(candidate)
    for barcode in barcodes:
      code_text = barcode.data.decode('utf-8')
      code_type = barcode.type
      if validate_ean13_checksum(code_text):
        return code_text, code_type

  try:
    detector = cv2.barcode.BarcodeDetector()
    ok, decoded_info, _, _ = detector.detectAndDecode(crop_img)
    if ok and decoded_info:
      for info in decoded_info:
        if info and validate_ean13_checksum(info):
          return info, 'OPENCV_DETECTED'
  except Exception:
    pass

  return None, None


if __name__ == '__main__':
  yaml_file = prepare_dataset_structure('datasets/barcode_dataset')
  model = train_yolo_model(yaml_file)