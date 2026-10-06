import type { BarcodeLocalization, CropRect } from "./barcodePreprocess.js";

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

function acquireProbeCanvas(srcW: number, srcH: number): HTMLCanvasElement {
  const maxDimension = 960;
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourcePlaceholder, 0, 0);
  return canvas;
}

// Kept as a tiny indirection so the browser-specific code below stays type-safe.
const sourcePlaceholder = {} as CanvasImageSource;

function nativeFormatsDetector(): {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; boundingBox?: DOMRectReadOnly }>>;
} | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  try {
    const Ctor = (window as unknown as {
      BarcodeDetector: new (opts: { formats: string[] }) => {
        detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; boundingBox?: DOMRectReadOnly }>>;
      };
    }).BarcodeDetector;
    return new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  } catch {
    return null;
  }
}

async function detectNativeRoi(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): Promise<BarcodeRoi | null> {
  const detector = nativeFormatsDetector();
  if (!detector) return null;

  const maxDimension = 960;
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, width, height);

  try {
    const detections = await detector.detect(canvas);
    const candidate = detections
      .filter((item) => item.rawValue && item.boundingBox)
      .map((item) => ({ item, area: (item.boundingBox?.width ?? 0) * (item.boundingBox?.height ?? 0) }))
      .sort((a, b) => b.area - a.area)[0]?.item;

    if (!candidate?.boundingBox) return null;

    const box = candidate.boundingBox;
    const detectedCrop = {
      x: box.x / scale,
      y: box.y / scale,
      width: box.width / scale,
      height: box.height / scale,
    };

    return {
      crop: clampCrop(detectedCrop, srcW, srcH),
      confidence: 0.94,
      source: "roi-detector",
    };
  } catch {
    return null;
  }
}

/**
 * ROI selection for the current web app.
 *
 * Order:
 *   1. injected YOLO/native detector;
 *   2. browser BarcodeDetector bounding box;
 *   3. fixed viewfinder ROI.
 *
 * Every result is axis-aligned. No image rotation or projective transform is
 * ever inferred from the ROI.
 */
export async function detectBarcodeRoi(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  options: { fallbackCrop?: CropRect } = {},
): Promise<BarcodeRoi> {
  if (customDetector) {
    try {
      const detected = await customDetector(source, srcW, srcH);
      if (detected && detected.confidence >= 0.5) {
        return {
          ...detected,
          crop: clampCrop(detected.crop, srcW, srcH),
          source: "roi-detector",
        };
      }
    } catch {
      // Fall through to the browser/native detector.
    }
  }

  const native = await detectNativeRoi(source, srcW, srcH);
  if (native) return native;

  return {
    crop: clampCrop(options.fallbackCrop ?? viewfinderCrop(srcW, srcH), srcW, srcH),
    confidence: 0.5,
    source: "viewfinder",
  };
}

export function localizationFromRoi(roi: BarcodeRoi): BarcodeLocalization {
  return {
    crop: roi.crop,
    confidence: roi.confidence,
    source: roi.source,
  };
}
