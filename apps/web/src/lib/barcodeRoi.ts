import type { CropRect } from "./barcodePreprocess.js";

export type BarcodeRoi = {
  crop: CropRect;
  confidence: number;
  source: "roi-detector" | "viewfinder";
};

export type BarcodeRoiDetector = (
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
) => Promise<BarcodeRoi | null>;

let customDetector: BarcodeRoiDetector | null = null;
const roiCache = new WeakMap<object, { at: number; roi: BarcodeRoi }>();

/**
 * Injection point for the production detector.
 *
 * On a native Android/iOS build this can be backed by YOLOv8-Nano (NCNN/ONNX)
 * and return one axis-aligned barcode ROI. The decoder never receives a
 * quadrilateral and never performs automatic perspective/orientation correction.
 */
export function registerBarcodeRoiDetector(detector: BarcodeRoiDetector | null): void {
  customDetector = detector;
}

function clampCrop(crop: CropRect, srcW: number, srcH: number): CropRect {
  const x = Math.max(0, Math.min(srcW - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(srcH - 1, Math.round(crop.y)));
  const right = Math.max(x + 1, Math.min(srcW, Math.round(crop.x + crop.width)));
  const bottom = Math.max(y + 1, Math.min(srcH, Math.round(crop.y + crop.height)));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function viewfinderCrop(srcW: number, srcH: number): CropRect {
  const width = Math.round(srcW * 0.82);
  const height = Math.round(srcH * 0.38);
  return {
    x: Math.max(0, Math.round((srcW - width) / 2)),
    y: Math.max(0, Math.round((srcH - height) / 2)),
    width,
    height,
  };
}

/**
 * ROI selection for the current web app.
 *
 * Order:
 *   1. injected YOLO/native detector;
 *   2. fixed viewfinder ROI.
 *
 * The browser fallback deliberately does NOT call BarcodeDetector for localization:
 * that would make the same barcode decoder both propose the ROI and decode it.
 * The two responsibilities stay independent.
 */
export async function detectBarcodeRoi(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  options: { fallbackCrop?: CropRect } = {},
): Promise<BarcodeRoi> {
  const cacheKey = source as object;
  const cached = roiCache.get(cacheKey);
  const now = performance.now();
  if (cached && now - cached.at < 250) return cached.roi;

  if (customDetector) {
    try {
      const detected = await customDetector(source, srcW, srcH);
      if (detected && detected.confidence >= 0.5) {
        const roi = {
          ...detected,
          crop: clampCrop(detected.crop, srcW, srcH),
          source: "roi-detector" as const,
        };
        roiCache.set(cacheKey, { at: performance.now(), roi });
        return roi;
      }
    } catch {
      // Fall through to the fixed viewfinder ROI.
    }
  }

  const fallback: BarcodeRoi = {
    crop: clampCrop(options.fallbackCrop ?? viewfinderCrop(srcW, srcH), srcW, srcH),
    confidence: 0.5,
    source: "viewfinder",
  };
  roiCache.set(cacheKey, { at: performance.now(), roi: fallback });
  return fallback;
}
