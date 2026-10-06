import { isValidGs1Checksum, productBarcodePriority } from "../domain/barcode.js";
import type { BarcodeBounds } from "../domain/barcode-scanner.js";
import { detectBarcodeRoi, type BarcodeRoi } from "./barcodeRoi.js";

export type PreprocessVariant = "raw" | "equalized" | "clahe" | "sauvola" | "bradley" | "upscaled";

export const PREPROCESS_VARIANTS: readonly PreprocessVariant[] = [
  "raw",
  "clahe",
  "sauvola",
  "upscaled",
  "equalized",
  "bradley",
];

export const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarcodeHit {
  rawValue: string;
  format?: string;
  variant: PreprocessVariant;
  center?: { x: number; y: number };
  bounds?: BarcodeBounds;
  validated: boolean;
  decoder: "native" | "zxing";
  supportCount?: number;
  decoderSupport?: number;
  localizationConfidence?: number;
  localizationSource?: BarcodeRoi["source"];
}

export interface BarcodeLocalization {
  crop: CropRect;
  confidence: number;
  source: BarcodeRoi["source"];
}

/* Native BarcodeDetector is used as the current browser ROI provider.
 * The provider is intentionally isolated in barcodeRoi.ts so a future
 * YOLOv8-Nano/ONNX or native mobile detector can be swapped in without
 * changing the decoder/preprocessing stack.
 */

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (
    source: ImageBitmapSource,
  ) => Promise<Array<{ rawValue: string; format?: string; boundingBox?: DOMRectReadOnly }>>;
};

let cachedDetector: InstanceType<DetectorCtor> | null = null;
type FallbackReader = import("@zxing/browser").BrowserMultiFormatOneDReader;
let cachedFallbackReader: Promise<FallbackReader | null> | null = null;

async function getFallbackReader(): Promise<FallbackReader | null> {
  if (!cachedFallbackReader) {
    cachedFallbackReader = import("@zxing/browser")
      .then(({ BrowserMultiFormatOneDReader }) => new BrowserMultiFormatOneDReader())
      .catch(() => null);
  }
  return cachedFallbackReader;
}

export function isBarcodeDetectorAvailable(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function getDetector(): InstanceType<DetectorCtor> | null {
  if (!isBarcodeDetectorAvailable()) return null;
  if (cachedDetector) return cachedDetector;
  try {
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    cachedDetector = new Ctor({ formats: [...BARCODE_FORMATS] });
    return cachedDetector;
  } catch {
    return null;
  }
}

const canvasPool = new Map<string, HTMLCanvasElement>();

function acquireCanvas(key: string, width: number, height: number): HTMLCanvasElement {
  let canvas = canvasPool.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvasPool.set(key, canvas);
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

export interface PreprocessOptions {
  maxDimension?: number;
  crop?: CropRect;
}

export interface PreprocessGeometry {
  crop: CropRect;
  outputWidth: number;
  outputHeight: number;
}

export function getPreprocessGeometry(
  srcW: number,
  srcH: number,
  variant: PreprocessVariant,
  opts: PreprocessOptions = {},
): PreprocessGeometry {
  const requestedCrop = opts.crop ?? { x: 0, y: 0, width: srcW, height: srcH };
  const cx = Math.max(0, Math.min(requestedCrop.x, Math.max(0, srcW - 1)));
  const cy = Math.max(0, Math.min(requestedCrop.y, Math.max(0, srcH - 1)));
  const cw = Math.max(1, Math.min(requestedCrop.width, Math.max(1, srcW - cx)));
  const ch = Math.max(1, Math.min(requestedCrop.height, Math.max(1, srcH - cy)));
  const maxDimension = opts.maxDimension ?? 1200;
  const scale = Math.min(1, maxDimension / Math.max(1, cw, ch));
  const baseW = Math.max(1, Math.round(cw * scale));
  const baseH = Math.max(1, Math.round(ch * scale));
  return {
    crop: { x: cx, y: cy, width: cw, height: ch },
    outputWidth: variant === "upscaled" ? baseW * 2 : baseW,
    outputHeight: variant === "upscaled" ? baseH * 2 : baseH,
  };
}

export function preprocessToCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  variant: PreprocessVariant,
  opts: PreprocessOptions = {},
): HTMLCanvasElement {
  const geometry = getPreprocessGeometry(srcW, srcH, variant, opts);
  const crop = geometry.crop;
  const canvas = acquireCanvas(variant, geometry.outputWidth, geometry.outputHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  const cx = Math.max(0, Math.min(crop.x, srcW - 1));
  const cy = Math.max(0, Math.min(crop.y, srcH - 1));
  const cw = Math.max(1, Math.min(crop.width, srcW - cx));
  const ch = Math.max(1, Math.min(crop.height, srcH - cy));

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = image.data;
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }

  switch (variant) {
    case "raw":
      break;
    case "equalized":
      histogramEqualize(gray);
      applyGamma(gray, 1.15);
      break;
    case "clahe":
      claheApprox(gray, canvas.width, canvas.height, 8, 2.5);
      break;
    case "sauvola":
      sauvolaThreshold(gray, canvas.width, canvas.height, 0.12, 0.34);
      break;
    case "bradley":
      bradleyThreshold(gray, canvas.width, canvas.height);
      break;
    case "upscaled":
      unsharpMask(gray, canvas.width, canvas.height, 0.9);
      break;
  }

  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    const value = gray[j];
    rgba[i] = value;
    rgba[i + 1] = value;
    rgba[i + 2] = value;
    rgba[i + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function histogramEqualize(gray: Uint8ClampedArray): void {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const cdf = new Uint32Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    cdf[i] = acc;
  }

  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i] > 0) {
      cdfMin = cdf[i];
      break;
    }
  }

  const total = gray.length;
  const denom = Math.max(1, total - cdfMin);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(((cdf[i] - cdfMin) / denom) * 255);
  }
  for (let i = 0; i < gray.length; i++) gray[i] = lut[gray[i]];
}

/** Lightweight tile CLAHE approximation for mobile Canvas. */
function claheApprox(gray: Uint8ClampedArray, w: number, h: number, tiles: number, clipLimit: number): void {
  const tw = Math.max(1, Math.ceil(w / tiles));
  const th = Math.max(1, Math.ceil(h / tiles));
  const out = new Uint8ClampedArray(gray.length);
  const lut = new Uint8ClampedArray(256);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x0 = tx * tw, x1 = Math.min(w, x0 + tw);
      const y0 = ty * th, y1 = Math.min(h, y0 + th);
      const hist = new Uint32Array(256);
      let count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[gray[y*w+x]]++; count++; }
      const limit = Math.max(1, Math.floor((count / 256) * clipLimit));
      let excess = 0;
      for (let i = 0; i < 256; i++) { if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; } }
      const add = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) hist[i] += add;
      let acc = 0;
      for (let i = 0; i < 256; i++) { acc += hist[i]; lut[i] = Math.round((acc / Math.max(1,count)) * 255); }
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[y*w+x] = lut[gray[y*w+x]];
    }
  }
  gray.set(out);
}

/** Sauvola: T(x,y)=m(x,y)*(1+k*(s/R-1)). Integral images keep it O(n). */
function sauvolaThreshold(gray: Uint8ClampedArray, w: number, h: number, k=0.12, r=0.34): void {
  const radius = Math.max(4, Math.floor(Math.min(w,h) * 0.035));
  const iw = w + 1;
  const sum = new Float64Array(iw * (h+1));
  const sq = new Float64Array(iw * (h+1));
  for (let y=0;y<h;y++) { let rs=0, rq=0; for (let x=0;x<w;x++) { const v=gray[y*w+x]; rs+=v; rq+=v*v; sum[(y+1)*iw+x+1]=sum[y*iw+x+1]+rs; sq[(y+1)*iw+x+1]=sq[y*iw+x+1]+rq; } }
  const out = new Uint8ClampedArray(gray.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const x0=Math.max(0,x-radius), x1=Math.min(w-1,x+radius), y0=Math.max(0,y-radius), y1=Math.min(h-1,y+radius);
    const A=y0*iw+x0, B=y0*iw+x1+1, C=(y1+1)*iw+x0, D=(y1+1)*iw+x1+1;
    const n=(x1-x0+1)*(y1-y0+1); const m=(sum[D]-sum[B]-sum[C]+sum[A])/n;
    const variance=Math.max(0,(sq[D]-sq[B]-sq[C]+sq[A])/n-m*m); const s=Math.sqrt(variance);
    const threshold=m*(1+k*(s/255/r-1)); out[y*w+x]=gray[y*w+x] <= threshold ? 0 : 255;
  }
  gray.set(out);
}

function applyGamma(gray: Uint8ClampedArray, gamma: number): void {
  const inv = 1 / gamma;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, inv));
  for (let i = 0; i < gray.length; i++) gray[i] = lut[gray[i]];
}

/**
 * Bradley–Roth adaptive threshold. Per ogni pixel confronta col valor medio del suo
 * intorno (blockSize × blockSize) meno una soglia t. Efficiente O(n) tramite
 * integral image (summed-area table).
 *
 * Perché non Otsu globale: una foto con riflesso laterale ha metà immagine chiara e
 * metà scura; una soglia globale taglierebbe il barcode a metà. La soglia locale
 * trova le barre nere ovunque si trovino.
 */
function bradleyThreshold(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  blockSizeFraction = 0.125,
  t = 0.15,
): void {
  const s = Math.max(8, Math.floor(Math.min(w, h) * blockSizeFraction));
  const half = s >> 1;

  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }

  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - half);
    const y2 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - half);
      const x2 = Math.min(w - 1, x + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[y1 * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      const mean = sum / count;
      out[y * w + x] = gray[y * w + x] <= mean * (1 - t) ? 0 : 255;
    }
  }
  gray.set(out);
}

/**
 * Unsharp mask leggero: blur gaussiano 3×3, poi amplifica la differenza. Usato sulla
 * variante upscaled per compensare la perdita di nitidezza dell'upscale.
 */
function unsharpMask(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  amount = 0.8,
): void {
  const blurred = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const k = dy === 0 ? (dx === 0 ? 4 : 2) : dx === 0 ? 2 : 1;
          sum += gray[ny * w + nx] * k;
          weight += k;
        }
      }
      blurred[y * w + x] = sum / weight;
    }
  }
  for (let i = 0; i < gray.length; i++) {
    const sharp = gray[i] + amount * (gray[i] - blurred[i]);
    gray[i] = sharp < 0 ? 0 : sharp > 255 ? 255 : sharp;
  }
}

// ── Check digit GS1 (EAN-8/13, UPC-A, GTIN-14) ────────────────────────────────

/**
 * Verifica il check digit GS1. L'algoritmo: si sommano le cifre in posizioni alternate
 * partendo da destra (esclusa la cifra di controllo) con pesi 3,1,3,1..., il check
 * digit è la cifra che porta la somma al multiplo di 10 successivo.
 *
 * Perché ci fidiamo di questo filtro: una lettura "sporca" del detector (frame sfocato,
 * riflesso, barcode parzialmente ostruito) può produrre una stringa di 13 cifre, ma
 * con probabilità ~90% NON passa il check digit. Quindi scartando i non-validati
 * eliminiamo quasi tutti i falsi positivi.
 */

// ── API di alto livello ───────────────────────────────────────────────────────



export function computeViewfinderCrop(
  srcW: number,
  srcH: number,
  mode: "standard" | "expanded" = "standard",
): CropRect {
  const widthFraction = mode === "expanded" ? 0.94 : 0.82;
  const heightFraction = mode === "expanded" ? 0.56 : 0.38;
  const width = Math.round(srcW * widthFraction);
  const height = Math.round(srcH * heightFraction);
  return {
    x: Math.max(0, Math.round((srcW - width) / 2)),
    y: Math.max(0, Math.round((srcH - height) / 2)),
    width,
    height,
  };
}

export function getBarcodeLocalization(
  _source: CanvasImageSource,
  srcW: number,
  srcH: number,
  mode: "standard" | "expanded" = "standard",
): BarcodeLocalization {
  return {
    crop: computeViewfinderCrop(srcW, srcH, mode),
    confidence: 0.5,
    source: "viewfinder",
  };
}

function addPadding(crop: CropRect, srcW: number, srcH: number, fraction = 0.08): CropRect {
  const padX = crop.width * fraction;
  const padY = crop.height * fraction;
  const left = Math.max(0, crop.x - padX);
  const top = Math.max(0, crop.y - padY);
  const right = Math.min(srcW, crop.x + crop.width + padX);
  const bottom = Math.min(srcH, crop.y + crop.height + padY);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
}

export interface ScanlineSpec {
  y: number;
  slope: number;
}

export function buildBarcodeScanlines(count = 14): ScanlineSpec[] {
  const safeCount = Math.max(10, Math.min(20, Math.floor(count)));
  const horizontalCount = Math.ceil(safeCount * 0.58);
  const angledCount = safeCount - horizontalCount;
  const lines: ScanlineSpec[] = [];

  for (let i = 0; i < horizontalCount; i++) {
    lines.push({
      y: 0.14 + (i / Math.max(1, horizontalCount - 1)) * 0.72,
      slope: 0,
    });
  }

  for (let i = 0; i < angledCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const index = Math.floor(i / 2);
    const magnitude = 0.012 + index * 0.012;
    lines.push({
      y: 0.2 + (index / Math.max(1, Math.ceil(angledCount / 2) - 1)) * 0.6,
      slope: side * Math.min(0.05, magnitude),
    });
  }

  return lines.slice(0, safeCount);
}

function sampleScanlineToCanvas(
  source: HTMLCanvasElement,
  line: ScanlineSpec,
  destination: HTMLCanvasElement,
): void {
  const width = source.width;
  const height = source.height;
  if (width <= 1 || height <= 1) return;

  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const destinationCtx = destination.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx || !destinationCtx) return;

  const image = sourceCtx.getImageData(0, 0, width, height);
  const stripHeight = destination.height;
  const data = destinationCtx.createImageData(destination.width, stripHeight);
  const xCenter = (width - 1) / 2;
  const baseY = line.y * (height - 1);

  for (let x = 0; x < width; x++) {
    const rawY = Math.max(0, Math.min(height - 1, Math.round(baseY + (x - xCenter) * line.slope)));
    const sourceIndex = (rawY * width + x) * 4;
    for (let y = 0; y < stripHeight; y++) {
      const destIndex = (y * width + x) * 4;
      data.data[destIndex] = image.data[sourceIndex];
      data.data[destIndex + 1] = image.data[sourceIndex + 1];
      data.data[destIndex + 2] = image.data[sourceIndex + 2];
      data.data[destIndex + 3] = 255;
    }
  }

  destinationCtx.putImageData(data, 0, 0);
}

function mapScanlinePointsToSource(
  points: unknown,
  geometry: PreprocessGeometry,
  line: ScanlineSpec,
  scanlineWidth: number,
): { center?: { x: number; y: number }; bounds?: BarcodeBounds } {
  if (!Array.isArray(points) || points.length === 0) return {};

  const mapped = points
    .map((point) => {
      const item = point as { getX?: () => number; getY?: () => number };
      const x = item.getX?.();
      if (typeof x !== "number") return null;
      const u = Math.max(0, Math.min(1, x / Math.max(1, scanlineWidth - 1)));
      const localY = Math.max(
        0,
        Math.min(
          1,
          line.y + ((u - 0.5) * line.slope),
        ),
      );
      return {
        x: geometry.crop.x + u * geometry.crop.width,
        y: geometry.crop.y + localY * geometry.crop.height,
      };
    })
    .filter((point): point is { x: number; y: number } => point !== null);

  if (mapped.length === 0) return {};
  const xs = mapped.map((point) => point.x);
  const ys = mapped.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    center: {
      x: mapped.reduce((sum, point) => sum + point.x, 0) / mapped.length,
      y: mapped.reduce((sum, point) => sum + point.y, 0) / mapped.length,
    },
    bounds: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(4, maxY - minY),
    },
  };
}

async function decodeCanvas(reader: FallbackReader, canvas: HTMLCanvasElement): Promise<{ rawValue: string; points: unknown } | null> {
  try {
    const result = reader.decodeFromCanvas(canvas);
    const rawValue = result.getText().trim();
    return rawValue
      ? {
          rawValue,
          points: typeof result.getResultPoints === "function" ? result.getResultPoints() : [],
        }
      : null;
  } catch {
    return null;
  }
}

async function decodeVariantWithScanlines(
  reader: FallbackReader,
  canvas: HTMLCanvasElement,
  geometry: PreprocessGeometry,
  variant: PreprocessVariant,
): Promise<BarcodeHit[]> {
  const lines = buildBarcodeScanlines(14);
  const strip = acquireCanvas(`scanline-${variant}`, canvas.width, 32);
  const hits: BarcodeHit[] = [];

  for (const line of lines) {
    sampleScanlineToCanvas(canvas, line, strip);
    const decoded = await decodeCanvas(reader, strip);
    if (!decoded) continue;

    const value = decoded.rawValue;
    if (!/^\\d{8,14}$/.test(value) || !isValidGs1Checksum(value)) continue;

    const location = mapScanlinePointsToSource(decoded.points, geometry, line, strip.width);
    hits.push({
      rawValue: value,
      variant,
      validated: true,
      decoder: "zxing",
      ...location,
    });
  }

  return hits;
}

async function detectNativeOnCanvas(
  detector: InstanceType<DetectorCtor>,
  canvas: HTMLCanvasElement,
  geometry: PreprocessGeometry,
  variant: PreprocessVariant,
  localization: BarcodeLocalization,
): Promise<BarcodeHit[]> {
  const result = await detector.detect(canvas);
  const hits: BarcodeHit[] = [];

  for (const item of result) {
    const rawValue = item.rawValue.trim();
    if (!/^\\d{8,14}$/.test(rawValue)) continue;
    const validated = isValidGs1Checksum(rawValue);
    if (!validated) continue;

    let bounds: BarcodeBounds | undefined;
    if (item.boundingBox) {
      bounds = {
        x: geometry.crop.x + (item.boundingBox.x / Math.max(1, canvas.width)) * geometry.crop.width,
        y: geometry.crop.y + (item.boundingBox.y / Math.max(1, canvas.height)) * geometry.crop.height,
        width: (item.boundingBox.width / Math.max(1, canvas.width)) * geometry.crop.width,
        height: (item.boundingBox.height / Math.max(1, canvas.height)) * geometry.crop.height,
      };
    }

    hits.push({
      rawValue,
      format: item.format,
      variant,
      validated: true,
      decoder: "native",
      localizationConfidence: localization.confidence,
      localizationSource: localization.source,
      ...(bounds ? {
        bounds,
        center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      } : {}),
    });
  }

  return hits;
}

export interface DetectOptions {
  maxDimension?: number;
  crop?: CropRect;
  variants?: readonly PreprocessVariant[];
  localization?: BarcodeLocalization;
  fallbackFullFrame?: boolean;
}

function rankBarcodeHits(
  hits: readonly BarcodeHit[],
  srcW: number,
  srcH: number,
  crop?: CropRect,
): BarcodeHit[] {
  type Group = {
    hit: BarcodeHit;
    count: number;
    variants: Set<PreprocessVariant>;
    decoders: Set<BarcodeHit["decoder"]>;
  };

  const groups = new Map<string, Group>();
  for (const hit of hits) {
    if (!isValidGs1Checksum(hit.rawValue)) continue;
    const current = groups.get(hit.rawValue);
    if (!current) {
      groups.set(hit.rawValue, {
        hit,
        count: 1,
        variants: new Set([hit.variant]),
        decoders: new Set([hit.decoder]),
      });
      continue;
    }

    current.count += 1;
    current.variants.add(hit.variant);
    current.decoders.add(hit.decoder);
    if (hit.validated && !current.hit.validated) current.hit = hit;
    if (!current.hit.bounds && hit.bounds) current.hit = hit;
  }

  const cx = crop ? crop.x + crop.width / 2 : srcW / 2;
  const cy = crop ? crop.y + crop.height / 2 : srcH / 2;
  const extent = Math.max(srcW, srcH);

  return [...groups.values()]
    .map((group) => {
      const hit = group.hit;
      const distance = hit.center
        ? Math.hypot(hit.center.x - cx, hit.center.y - cy) / Math.max(1, extent)
        : 1;
      const centerScore = Math.max(0, 10 - distance * 10);
      const score =
        100 +
        productBarcodePriority(hit.rawValue) / 4 +
        Math.min(30, group.count * 5) +
        Math.min(20, group.variants.size * 6) +
        Math.min(24, group.decoders.size * 12) +
        Math.min(16, (hit.localizationConfidence ?? 0) * 16) +
        centerScore;

      return {
        hit: {
          ...hit,
          supportCount: group.count,
          decoderSupport: group.decoders.size,
          localizationConfidence: hit.localizationConfidence,
        },
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit);
}

export async function detectBarcodes(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: DetectOptions = {},
): Promise<BarcodeHit[]> {
  const reader = await getFallbackReader();
  const detector = getDetector();
  if (!reader && !detector) return [];

  const maxDimension = opts.maxDimension ?? 1440;
  const variants = opts.variants ?? PREPROCESS_VARIANTS;
  const localization = opts.localization ?? await detectBarcodeRoi(source, srcW, srcH, {
    fallbackCrop: opts.crop ?? computeViewfinderCrop(srcW, srcH),
  });
  const crop = addPadding(localization.crop, srcW, srcH, 0.08);
  const hits: BarcodeHit[] = [];

  for (const variant of variants) {
    const geometry = getPreprocessGeometry(srcW, srcH, variant, { maxDimension, crop });
    const canvas = preprocessToCanvas(source, srcW, srcH, variant, { maxDimension, crop });

    if (detector) {
      try {
        hits.push(...await detectNativeOnCanvas(detector, canvas, geometry, variant, localization));
      } catch {
        // Continue with scanline reader.
      }
    }

    if (reader && ["raw", "clahe", "sauvola", "upscaled"].includes(variant)) {
      hits.push(...await decodeVariantWithScanlines(reader, canvas, geometry, variant));
    }

    if (hits.some((hit) => hit.validated && (hit.supportCount ?? 0) >= 3)) break;
  }

  const ranked = rankBarcodeHits(hits, srcW, srcH, crop);
  if (ranked.length > 0) return ranked;

  // Last-resort viewfinder pass. It is deliberately axis-aligned and carries no
  // orientation/perspective transform, so a straight barcode can never be rotated
  // by the localizer.
  if (!opts.fallbackFullFrame && localization.source !== "viewfinder") {
    return detectBarcodes(source, srcW, srcH, {
      ...opts,
      localization: {
        crop: computeViewfinderCrop(srcW, srcH),
        confidence: 0.5,
        source: "viewfinder",
      },
      fallbackFullFrame: true,
    });
  }

  return [];
}

export async function detectBestBarcode(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: DetectOptions = {},
): Promise<BarcodeHit | null> {
  const hits = await detectBarcodes(source, srcW, srcH, opts);
  if (hits.length === 0) return null;
  return hits[0] ?? null;
}
