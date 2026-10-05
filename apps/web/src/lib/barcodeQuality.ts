import {
  classifyFrameQuality,
  type FrameQualityResult,
} from "../domain/barcode-scanner.js";
import type { CropRect } from "./barcodePreprocess.js";

export interface BarcodeFrameSample {
  metrics: FrameQualityResult;
  fingerprint: Uint8Array;
}

const SAMPLE_WIDTH = 320;
const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

function toGrayscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return gray;
}

/**
 * Measures the small ROI that the user sees rather than the whole camera frame.
 * The sample is intentionally tiny: quality feedback must not compete with decoding.
 */
export function analyzeBarcodeFrame(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  crop: CropRect,
  previousFingerprint?: Uint8Array,
): BarcodeFrameSample | null {
  if (!canvas || srcW <= 0 || srcH <= 0 || crop.width <= 0 || crop.height <= 0) {
    return null;
  }

  const scale = Math.min(1, SAMPLE_WIDTH / crop.width);
  const width = Math.max(32, Math.round(crop.width * scale));
  const height = Math.max(16, Math.round(crop.height * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const gray = toGrayscale(image.data, width, height);

  let sum = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (let i = 0; i < gray.length; i++) {
    const value = gray[i];
    sum += value;
    sumSquares += value * value;
    if (value <= 3 || value >= 252) clipped++;
  }
  const meanLuma = sum / gray.length;
  const variance = Math.max(0, sumSquares / gray.length - meanLuma * meanLuma);
  const contrast = Math.sqrt(variance);

  let laplacianSum = 0;
  let laplacianSumSquares = 0;
  let laplacianCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = gray[y * width + x] * 4;
      const laplacian =
        center -
        gray[y * width + x - 1] -
        gray[y * width + x + 1] -
        gray[(y - 1) * width + x] -
        gray[(y + 1) * width + x];
      laplacianSum += laplacian;
      laplacianSumSquares += laplacian * laplacian;
      laplacianCount++;
    }
  }
  const laplacianMean = laplacianCount > 0 ? laplacianSum / laplacianCount : 0;
  const sharpness = laplacianCount > 0
    ? Math.max(0, laplacianSumSquares / laplacianCount - laplacianMean * laplacianMean)
    : 0;

  let motion = 0;
  if (previousFingerprint && previousFingerprint.length === gray.length) {
    let difference = 0;
    let samples = 0;
    for (let i = 0; i < gray.length; i += 2) {
      difference += Math.abs(gray[i] - previousFingerprint[i]);
      samples++;
    }
    // Normalize by a full grayscale span. Values around 0.02-0.05 are typical
    // for a stable handheld view; large changes imply shake or a scene move.
    motion = samples > 0 ? difference / samples / 255 : 0;
  }

  return {
    metrics: classifyFrameQuality({
      sharpness,
      contrast,
      motion,
      clippedFraction: clipped / gray.length,
      meanLuma,
    }),
    fingerprint: gray,
  };
}
