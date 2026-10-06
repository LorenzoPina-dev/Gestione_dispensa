import { isValidGs1Checksum, productBarcodePriority } from "../domain/barcode.js";
import { estimateBarcodeOrientationFromMoments } from "../domain/barcode-scanner.js";
import type { BarcodeBounds } from "../domain/barcode-scanner.js";
// services/web/src/lib/barcodePreprocess.ts
//
// Preprocessing adattivo per la scansione barcode: grayscale, equalizzazione
// dell'istogramma, gamma correction, Bradley adaptive threshold, unsharp mask.
// Pensato per essere chiamato sia su frame video (loop live) che su foto caricate.
//
// Il detector nativo BarcodeDetector funziona discretamente su immagini "pulite",
// ma su plastica lucida / luce non uniforme / messa a fuoco morbida può fallire.
// Le varianti vengono provate in ordine con early-exit, così miglioriamo la
// robustezza senza saturare il main thread durante la scansione live.

export type PreprocessVariant = "raw" | "equalized" | "clahe" | "sauvola" | "bradley" | "upscaled";

/** Ordine di esecuzione: prima le varianti più economiche, con early-exit sui match affidabili. */
export const PREPROCESS_VARIANTS: readonly PreprocessVariant[] = [
  "raw",
  "equalized",
  "clahe",
  "sauvola",
  "bradley",
  "upscaled",
];

/** Formati che copriamo. BarcodeDetector ignora silenziosamente quelli non supportati. */
export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "data_matrix",
  "qr_code",
] as const;

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
  /** Centro del bounding box in coordinate sorgente (pre-crop). */
  center?: { x: number; y: number };
  /** Bounding box in coordinate sorgente (pre-crop), when exposed by the decoder. */
  bounds?: BarcodeBounds;
  /** True se il valore supera il check digit GS1 (EAN/UPC/GTIN). */
  validated: boolean;
  /** Decoder that produced this observation. */
  decoder: "native" | "zxing";
  /** Number of decoder/variant observations fused into the returned hit. */
  supportCount?: number;
  /** Distinct decoders supporting the same numeric candidate. */
  decoderSupport?: number;
  /** Localization confidence for the physical barcode region. */
  localizationConfidence?: number;
}

// ── Disponibilità detector ────────────────────────────────────────────────────

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

async function detectWithFallback(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: DetectOptions = {},
): Promise<BarcodeHit[]> {
  const reader = await getFallbackReader();
  if (!reader) return [];

  const maxDimension = opts.maxDimension ?? 1200;
  const variants = opts.variants ?? PREPROCESS_VARIANTS;
  const localized = opts.localization ?? localizeBarcode(source, srcW, srcH);
  const useLocalizedCrop = localized.confidence >= 0.42;
  const useGeometryCorrection = canApplyBarcodeGeometry(localized);
  const crop = useLocalizedCrop ? localized.crop : opts.crop;
  const rotation = useGeometryCorrection ? localized.rotation : 0;
  const quadrilateral = useGeometryCorrection ? localized.quadrilateral : undefined;
  const hits: BarcodeHit[] = [];

  for (const variant of variants) {
    try {
      const geometry = getPreprocessGeometry(srcW, srcH, variant, {
        maxDimension,
        ...(crop ? { crop } : {}),
        rotation,
        ...(quadrilateral ? { quadrilateral } : {}),
      });
      const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
        maxDimension,
        crop: geometry.crop,
        rotation,
        ...(quadrilateral ? { quadrilateral } : {}),
      });
      const result = reader.decodeFromCanvas(canvas);
      const rawValue = result.getText().trim();
      if (!rawValue) continue;

      const location = mapFallbackPointsToSource(
        typeof result.getResultPoints === "function" ? result.getResultPoints() : [],
        geometry,
      );
      const hit: BarcodeHit = {
        rawValue,
        variant,
        validated: isValidGs1Checksum(rawValue),
        decoder: "zxing",
        localizationConfidence: localized.confidence,
        ...(location.center ? { center: location.center } : {}),
        ...(location.bounds ? { bounds: location.bounds } : {}),
      };
      hits.push(hit);
    } catch {
      // No barcode in this variant; continue with the next preprocessing pass.
    }
  }

  return rankBarcodeHits(hits, srcW, srcH, opts.crop);
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

// ── Pool canvas (evita GC pressure ad ogni frame) ─────────────────────────────

const canvasPool = new Map<string, HTMLCanvasElement>();

function acquireCanvas(key: string, w: number, h: number): HTMLCanvasElement {
  let c = canvasPool.get(key);
  if (!c) {
    c = document.createElement("canvas");
    canvasPool.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

// ── Pipeline di preprocessing ─────────────────────────────────────────────────

export interface PreprocessOptions {
  /** Lato più lungo del canvas di output PRIMA dell'eventuale upscale 2×. */
  maxDimension?: number;
  /** Ritaglio in coordinate sorgente. Default: intera immagine. */
  crop?: CropRect;
  /** Rotation applied around the crop center before preprocessing. */
  rotation?: number;
  /** Four source points used to perform projective rectification before preprocessing. */
  quadrilateral?: BarcodeQuadrilateral;
}

export interface PreprocessGeometry {
  crop: CropRect;
  outputWidth: number;
  outputHeight: number;
  rotation: number;
  quadrilateral?: BarcodeQuadrilateral;
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
  const maxDimension = opts.maxDimension ?? 800;
  const quad = opts.quadrilateral;
  const quadWidth = quad
    ? Math.max(
        Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y),
        Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y),
      )
    : cw;
  const quadHeight = quad
    ? Math.max(
        Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y),
        Math.hypot(quad.bottomRight.x - quad.topRight.x, quad.bottomRight.y - quad.topRight.y),
      )
    : ch;
  const scale = Math.min(1, maxDimension / Math.max(1, quadWidth, quadHeight));
  const baseW = Math.max(1, Math.round(quadWidth * scale));
  const baseH = Math.max(1, Math.round(quadHeight * scale));

  return {
    crop: { x: cx, y: cy, width: cw, height: ch },
    outputWidth: variant === "upscaled" ? baseW * 2 : baseW,
    outputHeight: variant === "upscaled" ? baseH * 2 : baseH,
    rotation: opts.rotation ?? 0,
    ...(quad ? { quadrilateral: quad } : {}),
  };
}

function mapOutputRectToSource(
  rect: { x: number; y: number; width: number; height: number },
  geometry: PreprocessGeometry,
): BarcodeBounds {
  const q = geometry.quadrilateral;
  if (!q) {
    return {
      x: geometry.crop.x + (rect.x / geometry.outputWidth) * geometry.crop.width,
      y: geometry.crop.y + (rect.y / geometry.outputHeight) * geometry.crop.height,
      width: (rect.width / geometry.outputWidth) * geometry.crop.width,
      height: (rect.height / geometry.outputHeight) * geometry.crop.height,
    };
  }

  const homography = solveHomographyFromUnitSquare(q);
  if (!homography) {
    return {
      x: geometry.crop.x + (rect.x / geometry.outputWidth) * geometry.crop.width,
      y: geometry.crop.y + (rect.y / geometry.outputHeight) * geometry.crop.height,
      width: (rect.width / geometry.outputWidth) * geometry.crop.width,
      height: (rect.height / geometry.outputHeight) * geometry.crop.height,
    };
  }

  const mapPoint = (x: number, y: number): BarcodePoint => {
    const u = geometry.outputWidth <= 1 ? 0 : x / (geometry.outputWidth - 1);
    const v = geometry.outputHeight <= 1 ? 0 : y / (geometry.outputHeight - 1);
    const denom = homography[6] * u + homography[7] * v + 1;
    if (Math.abs(denom) < 1e-9) return { x: geometry.crop.x, y: geometry.crop.y };
    return {
      x: (homography[0] * u + homography[1] * v + homography[2]) / denom,
      y: (homography[3] * u + homography[4] * v + homography[5]) / denom,
    };
  };

  const points = [
    mapPoint(rect.x, rect.y),
    mapPoint(rect.x + rect.width, rect.y),
    mapPoint(rect.x + rect.width, rect.y + rect.height),
    mapPoint(rect.x, rect.y + rect.height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
  };
}

function mapFallbackPointsToSource(
  points: unknown,
  geometry: PreprocessGeometry,
): { center?: { x: number; y: number }; bounds?: BarcodeBounds } {
  if (!Array.isArray(points) || points.length === 0) return {};

  const homography = geometry.quadrilateral ? solveHomographyFromUnitSquare(geometry.quadrilateral) : null;
  const mapped = points
    .map((point) => {
      const candidate = point as { getX?: () => number; getY?: () => number };
      const x = candidate.getX?.();
      const y = candidate.getY?.();
      if (typeof x !== "number" || typeof y !== "number") return null;
      if (homography) {
        const u = geometry.outputWidth <= 1 ? 0 : x / (geometry.outputWidth - 1);
        const v = geometry.outputHeight <= 1 ? 0 : y / (geometry.outputHeight - 1);
        const denominator = homography[6] * u + homography[7] * v + 1;
        if (Math.abs(denominator) > 1e-9) {
          return {
            x: (homography[0] * u + homography[1] * v + homography[2]) / denominator,
            y: (homography[3] * u + homography[4] * v + homography[5]) / denominator,
          };
        }
      }
      return {
        x: geometry.crop.x + (x / geometry.outputWidth) * geometry.crop.width,
        y: geometry.crop.y + (y / geometry.outputHeight) * geometry.crop.height,
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
      height: Math.max(1, maxY - minY),
    },
  };
}

/**
 * Applica la pipeline di preprocessing e restituisce il canvas pronto per il detector.
 * Il canvas è preso da un pool interno per variante: non va conservato dal chiamante.
 */

function solveHomographyFromUnitSquare(q: BarcodeQuadrilateral): Float64Array | null {
  const src = [
    { x: 0, y: 0, d: q.topLeft },
    { x: 1, y: 0, d: q.topRight },
    { x: 1, y: 1, d: q.bottomRight },
    { x: 0, y: 1, d: q.bottomLeft },
  ];

  // Solve the 8 unknowns of:
  // x = (h00*u + h01*v + h02) / (h20*u + h21*v + 1)
  // y = (h10*u + h11*v + h12) / (h20*u + h21*v + 1)
  const a = Array.from({ length: 8 }, () => new Float64Array(9));
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v, d } = src[i];
    const row = i * 2;
    a[row][0] = u; a[row][1] = v; a[row][2] = 1;
    a[row][6] = -d.x * u; a[row][7] = -d.x * v; a[row][8] = d.x;
    a[row + 1][3] = u; a[row + 1][4] = v; a[row + 1][5] = 1;
    a[row + 1][6] = -d.y * u; a[row + 1][7] = -d.y * v; a[row + 1][8] = d.y;
  }

  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    const div = a[col][col];
    for (let k = col; k <= 8; k++) a[col][k] /= div;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let k = col; k <= 8; k++) a[row][k] -= factor * a[col][k];
    }
  }

  return new Float64Array([a[0][8], a[1][8], a[2][8], a[3][8], a[4][8], a[5][8], a[6][8], a[7][8], 1]);
}

function drawRectifiedQuad(
  source: CanvasImageSource,
  q: BarcodeQuadrilateral,
  outW: number,
  outH: number,
  destination: HTMLCanvasElement,
): void {
  const homography = solveHomographyFromUnitSquare(q);
  if (!homography) {
    const ctx = destination.getContext("2d");
    if (ctx) ctx.drawImage(source, q.topLeft.x, q.topLeft.y, Math.max(1, q.topRight.x - q.topLeft.x), Math.max(1, q.bottomLeft.y - q.topLeft.y), 0, 0, outW, outH);
    return;
  }

  const bounds = {
    x: Math.min(q.topLeft.x, q.topRight.x, q.bottomLeft.x, q.bottomRight.x),
    y: Math.min(q.topLeft.y, q.topRight.y, q.bottomLeft.y, q.bottomRight.y),
    right: Math.max(q.topLeft.x, q.topRight.x, q.bottomLeft.x, q.bottomRight.x),
    bottom: Math.max(q.topLeft.y, q.topRight.y, q.bottomLeft.y, q.bottomRight.y),
  };
  const bw = Math.max(1, Math.ceil(bounds.right - bounds.x));
  const bh = Math.max(1, Math.ceil(bounds.bottom - bounds.y));
  const sourceCanvas = acquireCanvas("rectify-source", bw, bh);
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const dstCtx = destination.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx || !dstCtx) return;

  sourceCtx.imageSmoothingEnabled = true;
  sourceCtx.imageSmoothingQuality = "high";
  sourceCtx.clearRect(0, 0, bw, bh);
  sourceCtx.drawImage(source, bounds.x, bounds.y, bw, bh, 0, 0, bw, bh);
  const sourceData = sourceCtx.getImageData(0, 0, bw, bh);
  const out = dstCtx.createImageData(outW, outH);
  const data = out.data;

  for (let y = 0; y < outH; y++) {
    const v = outH === 1 ? 0 : y / (outH - 1);
    for (let x = 0; x < outW; x++) {
      const u = outW === 1 ? 0 : x / (outW - 1);
      const denom = homography[6] * u + homography[7] * v + 1;
      if (Math.abs(denom) < 1e-9) continue;
      const px = homography[0] * u + homography[1] * v + homography[2];
      const py = homography[3] * u + homography[4] * v + homography[5];
      const sx = px / denom - bounds.x;
      const sy = py / denom - bounds.y;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= bw || y0 >= bh) continue;
      const x1 = Math.min(bw - 1, x0 + 1);
      const y1 = Math.min(bh - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const di = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = sourceData.data[(y0 * bw + x0) * 4 + c];
        const p10 = sourceData.data[(y0 * bw + x1) * 4 + c];
        const p01 = sourceData.data[(y1 * bw + x0) * 4 + c];
        const p11 = sourceData.data[(y1 * bw + x1) * 4 + c];
        data[di + c] = Math.round(
          p00 * (1 - tx) * (1 - ty) +
          p10 * tx * (1 - ty) +
          p01 * (1 - tx) * ty +
          p11 * tx * ty,
        );
      }
      data[di + 3] = 255;
    }
  }
  dstCtx.putImageData(out, 0, 0);
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
  // Clamp del crop ai bordi: drawImage con rect fuori bounds è undefined-behaviour.
  const cx = Math.max(0, Math.min(crop.x, srcW - 1));
  const cy = Math.max(0, Math.min(crop.y, srcH - 1));
  const cw = Math.max(1, Math.min(crop.width, srcW - cx));
  const ch = Math.max(1, Math.min(crop.height, srcH - cy));

  // Geometry is computed once so decoder coordinates map back to source pixels exactly.
  const { outputWidth: outW, outputHeight: outH } = geometry;

  const canvas = acquireCanvas(variant, outW, outH);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, outW, outH);

  if (geometry.quadrilateral) {
    drawRectifiedQuad(source, geometry.quadrilateral, outW, outH, canvas);
  } else if (Math.abs(geometry.rotation) > 0.001) {
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(-geometry.rotation);
    ctx.drawImage(source, cx, cy, cw, ch, -outW / 2, -outH / 2, outW, outH);
    ctx.restore();
  } else {
    ctx.drawImage(source, cx, cy, cw, ch, 0, 0, outW, outH);
  }

  const img = ctx.getImageData(0, 0, outW, outH);
  const rgba = img.data;
  const gray = new Uint8ClampedArray(outW * outH);

  // 1. Grayscale (Rec. 601): una sola passata, aritmetica intera.
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }

  switch (variant) {
    case "raw":
      // Niente: lasciamo al detector la versione grayscale pura.
      break;
    case "equalized":
      histogramEqualize(gray);
      applyGamma(gray, 1.15);
      break;
    case "clahe":
      claheApprox(gray, outW, outH, 8, 2.5);
      break;
    case "sauvola":
      sauvolaThreshold(gray, outW, outH, 0.12, 0.34);
      break;
    case "bradley":
      bradleyThreshold(gray, outW, outH);
      break;
    case "upscaled":
      unsharpMask(gray, outW, outH, 0.9);
      break;
  }

  // Riscrivi il canale gray nei 3 canali RGB (il detector gradisce input RGB).
  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    const v = gray[j];
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Equalizzazione dell'istogramma con CDF-min shift: evita di sovra-stirare quando il
 * barcode è già ad alto contrasto (caso comune: bianco/nero su fondo blu).
 */
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


export type BarcodePoint = { x: number; y: number };
export type BarcodeQuadrilateral = {
  topLeft: BarcodePoint;
  topRight: BarcodePoint;
  bottomRight: BarcodePoint;
  bottomLeft: BarcodePoint;
};

export interface BarcodeLocalization {
  crop: CropRect;
  quadrilateral: BarcodeQuadrilateral;
  /** Rotation actually applied to the rectification geometry, in radians. */
  rotation: number;
  /** Raw orientation estimate retained for a recovery pass; never applied blindly. */
  suggestedRotation: number;
  /** Overall confidence that the detected region is a barcode candidate. */
  confidence: number;
  /** Confidence that the estimated bar orientation is reliable enough to rotate. */
  orientationConfidence: number;
  /** Confidence that the candidate geometry is safe for perspective rectification. */
  geometryConfidence: number;
  textureScore: number;
}

function barcodeGeometryConfidence(input: {
  width: number;
  height: number;
  topWidth?: number;
  bottomWidth?: number;
  topCenter?: number;
  bottomCenter?: number;
}): number {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const aspectRatio = width / height;
  const aspectScore = Math.max(0, Math.min(1, (aspectRatio - 2) / 5));

  if (
    input.topWidth == null ||
    input.bottomWidth == null ||
    input.topCenter == null ||
    input.bottomCenter == null
  ) {
    return 0.42 * aspectScore + 0.58 * 0.55;
  }

  const topWidth = Math.max(1, input.topWidth);
  const bottomWidth = Math.max(1, input.bottomWidth);
  const widthConsistency = Math.min(topWidth, bottomWidth) / Math.max(topWidth, bottomWidth);
  const centerOffset = Math.abs(input.topCenter - input.bottomCenter) / width;
  const centerConsistency = Math.max(0, Math.min(1, 1 - centerOffset / 0.28));

  return Math.max(
    0,
    Math.min(
      1,
      0.42 * aspectScore +
        0.33 * widthConsistency +
        0.25 * centerConsistency,
    ),
  );
}

export function canApplyBarcodeGeometry(localized: BarcodeLocalization): boolean {
  return localized.confidence >= 0.42 && localized.geometryConfidence >= 0.68;
}

export function localizeBarcode(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxDimension = 640,
): BarcodeLocalization {
  const full: BarcodeLocalization = {
    crop: { x: 0, y: 0, width: srcW, height: srcH },
    quadrilateral: {
      topLeft: { x: 0, y: 0 },
      topRight: { x: srcW, y: 0 },
      bottomRight: { x: srcW, y: srcH },
      bottomLeft: { x: 0, y: srcH },
    },
    rotation: 0,
    suggestedRotation: 0,
    confidence: 0,
    orientationConfidence: 0,
    geometryConfidence: 0,
    textureScore: 0,
  };

  if (srcW < 96 || srcH < 96) return full;

  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const w = Math.max(64, Math.round(srcW * scale));
  const h = Math.max(64, Math.round(srcH * scale));
  const canvas = acquireCanvas("localizer", w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return full;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, w, h);

  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }

  const row = new Float64Array(h);
  let total = 0;

  for (let y = 1; y < h - 1; y++) {
    const b = y * w;
    for (let x = 1; x < w - 1; x++) {
      const gx = Math.abs(gray[b + x + 1] - gray[b + x - 1]);
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      const e = Math.max(0, gx - 0.7 * gy);
      row[y] += e;
      total += e;
    }
  }

  if (total <= 1) return full;

  function bestBand(
    values: Float64Array,
    threshold: number,
    minLength: number,
  ): { start: number; end: number; score: number } | null {
    let bestStart = -1;
    let bestEnd = -1;
    let bestScore = -Infinity;
    let start = -1;
    let sum = 0;

    for (let i = 0; i < values.length; i++) {
      if (values[i] >= threshold) {
        if (start < 0) {
          start = i;
          sum = 0;
        }
        sum += values[i];
        continue;
      }

      if (start < 0) continue;
      const end = i - 1;
      if (end - start + 1 >= minLength) {
        const score = sum / Math.max(1, end - start + 1);
        if (score > bestScore) {
          bestStart = start;
          bestEnd = end;
          bestScore = score;
        }
      }
      start = -1;
      sum = 0;
    }

    if (start >= 0) {
      const end = values.length - 1;
      if (end - start + 1 >= minLength) {
        const score = sum / Math.max(1, end - start + 1);
        if (score > bestScore) {
          bestStart = start;
          bestEnd = end;
          bestScore = score;
        }
      }
    }

    return bestStart >= 0
      ? { start: bestStart, end: bestEnd, score: bestScore }
      : null;
  }

  const yBand = bestBand(row, (total / h) * 1.25, Math.max(18, Math.floor(h * 0.06)));
  if (!yBand) {
    return { ...full, textureScore: total / Math.max(1, w * h) };
  }

  const bandHeight = yBand.end - yBand.start + 1;
  const focusY0 = Math.max(1, yBand.start - Math.floor(bandHeight * 0.55));
  const focusY1 = Math.min(h - 2, yBand.end + Math.floor(bandHeight * 0.55));
  const focusCol = new Float64Array(w);

  for (let y = focusY0; y <= focusY1; y++) {
    const rowBase = y * w;
    for (let x = 1; x < w - 1; x++) {
      const gx = Math.abs(gray[rowBase + x + 1] - gray[rowBase + x - 1]);
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      const e = Math.max(0, gx - 0.7 * gy);
      focusCol[x] += e;
    }
  }

  const smoothProjection = (values: Float64Array, radius: number): Float64Array => {
    const result = new Float64Array(values.length);
    const prefix = new Float64Array(values.length + 1);
    for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
    for (let i = 0; i < values.length; i++) {
      const left = Math.max(0, i - radius);
      const right = Math.min(values.length - 1, i + radius);
      result[i] = (prefix[right + 1] - prefix[left]) / Math.max(1, right - left + 1);
    }
    return result;
  };

  const smoothedX = smoothProjection(focusCol, Math.max(2, Math.round(w * 0.015)));
  const xMean = smoothedX.reduce((sum, value) => sum + value, 0) / Math.max(1, w);
  const xBand = bestBand(smoothedX, xMean * 1.18, Math.max(24, Math.floor(w * 0.06)));
  if (!xBand) {
    return { ...full, textureScore: total / Math.max(1, w * h) };
  }

  const xBandWidth = xBand.end - xBand.start + 1;
  const candidatePadX = Math.max(8, Math.round(xBandWidth * 0.10));
  const candidatePadY = Math.max(8, Math.round(bandHeight * 0.32));
  const candidateX0 = Math.max(1, xBand.start - candidatePadX);
  const candidateX1 = Math.min(w - 2, xBand.end + candidatePadX);
  const candidateY0 = Math.max(1, yBand.start - candidatePadY);
  const candidateY1 = Math.min(h - 2, yBand.end + candidatePadY);
  const candidateWidth = Math.max(1, candidateX1 - candidateX0 + 1);
  const candidateHeight = Math.max(1, candidateY1 - candidateY0 + 1);
  const candidateArea = Math.max(1, candidateWidth * candidateHeight);

  // Estimate orientation ONLY inside the candidate barcode region. The rest of the
  // package (text, logos, box edges) can no longer tilt the whole image.
  let candidateEnergy = 0;
  let gxEnergy = 0;
  let gyEnergy = 0;
  for (let y = candidateY0; y <= candidateY1; y++) {
    const rowBase = y * w;
    for (let x = candidateX0; x <= candidateX1; x++) {
      const gx = Math.abs(gray[rowBase + x + 1] - gray[rowBase + x - 1]);
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      const e = Math.max(0, gx - 0.7 * gy);
      candidateEnergy += e;
      gxEnergy += gx;
      gyEnergy += gy;
    }
  }

  const candidateMeanEnergy = candidateEnergy / candidateArea;
  const orientationThreshold = Math.max(38, candidateMeanEnergy * 1.7);
  let strong = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (let y = candidateY0; y <= candidateY1; y++) {
    const rowBase = y * w;
    for (let x = candidateX0; x <= candidateX1; x++) {
      const gx = Math.abs(gray[rowBase + x + 1] - gray[rowBase + x - 1]);
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      const e = Math.max(0, gx - 0.7 * gy);
      if (e < orientationThreshold) continue;
      strong += e;
      sx += x * e;
      sy += y * e;
      sxx += x * x * e;
      syy += y * y * e;
      sxy += x * y * e;
    }
  }

  const varianceX = strong > 0 ? Math.max(0, sxx / strong - (sx / strong) ** 2) : 0;
  const varianceY = strong > 0 ? Math.max(0, syy / strong - (sy / strong) ** 2) : 0;
  const covariance = strong > 0 ? sxy / strong - (sx / strong) * (sy / strong) : 0;
  const orientation = estimateBarcodeOrientationFromMoments({
    varianceX,
    varianceY,
    covariance,
    gxEnergy,
    gyEnergy,
    aspectRatio: candidateWidth / candidateHeight,
  });

  const concentration =
    (xBand.score / Math.max(1, total / w)) *
    (yBand.score / Math.max(1, total / h));

  const candidateAreaFraction = candidateArea / Math.max(1, w * h);
  const compactness = Math.max(0, Math.min(1, 1 - candidateAreaFraction / 0.72));
  // Initial geometry is built before rotation. It is intentionally tight; the old
  // 22%/65% padding made the visual hitbox much larger than the actual bars.
  const padX = Math.max(12, Math.round(xBandWidth * 0.12));
  const padY = Math.max(12, Math.round(bandHeight * 0.36));
  const x0 = Math.max(0, xBand.start - padX);
  const x1 = Math.min(w - 1, xBand.end + padX);
  const y0 = Math.max(0, yBand.start - padY);
  const y1 = Math.min(h - 1, yBand.end + padY);

  // Recompute upper/lower projections ONLY inside the candidate x-range. This
  // prevents unrelated package content elsewhere in the frame from creating a fake
  // trapezoid.
  const topFocused = new Float64Array(w);
  const bottomFocused = new Float64Array(w);
  const yMid = Math.floor((candidateY0 + candidateY1) / 2);
  for (let y = candidateY0; y <= candidateY1; y++) {
    const rowBase = y * w;
    const target = y <= yMid ? topFocused : bottomFocused;
    for (let x = candidateX0; x <= candidateX1; x++) {
      const gx = Math.abs(gray[rowBase + x + 1] - gray[rowBase + x - 1]);
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      target[x] += Math.max(0, gx - 0.7 * gy);
    }
  }

  const smoothedTop = smoothProjection(topFocused, Math.max(2, Math.round(w * 0.015)));
  const smoothedBottom = smoothProjection(bottomFocused, Math.max(2, Math.round(w * 0.015)));
  const topMean = smoothedTop.reduce((sum, value) => sum + value, 0) / Math.max(1, w);
  const bottomMean = smoothedBottom.reduce((sum, value) => sum + value, 0) / Math.max(1, w);
  const topBand = bestBand(smoothedTop, topMean * 1.15, Math.max(18, Math.floor(w * 0.035)));
  const bottomBand = bestBand(smoothedBottom, bottomMean * 1.15, Math.max(18, Math.floor(w * 0.035)));

  const inv = 1 / scale;
  const sourceX0 = Math.floor(x0 * inv);
  const sourceX1 = Math.min(srcW - 1, Math.ceil((x1 + 1) * inv) - 1);
  const sourceY0 = Math.floor(y0 * inv);
  const sourceY1 = Math.min(srcH - 1, Math.ceil((y1 + 1) * inv) - 1);

  const topX0 = topBand
    ? Math.floor(Math.max(0, topBand.start - padX) * inv)
    : sourceX0;
  const topX1 = topBand
    ? Math.ceil(Math.min(w - 1, topBand.end + padX + 1) * inv)
    : sourceX1 + 1;
  const bottomX0 = bottomBand
    ? Math.floor(Math.max(0, bottomBand.start - padX) * inv)
    : sourceX0;
  const bottomX1 = bottomBand
    ? Math.ceil(Math.min(w - 1, bottomBand.end + padX + 1) * inv)
    : sourceX1 + 1;

  const baseQuad: BarcodeQuadrilateral = {
    topLeft: { x: Math.max(0, topX0), y: Math.max(0, sourceY0) },
    topRight: { x: Math.min(srcW, topX1), y: Math.max(0, sourceY0) },
    bottomRight: { x: Math.min(srcW, bottomX1), y: Math.min(srcH, sourceY1 + 1) },
    bottomLeft: { x: Math.max(0, bottomX0), y: Math.min(srcH, sourceY1 + 1) },
  };

  const topWidth = Math.abs(baseQuad.topRight.x - baseQuad.topLeft.x);
  const bottomWidth = Math.abs(baseQuad.bottomRight.x - baseQuad.bottomLeft.x);
  const topCenter = (baseQuad.topLeft.x + baseQuad.topRight.x) / 2;
  const bottomCenter = (baseQuad.bottomLeft.x + baseQuad.bottomRight.x) / 2;
  const geometryConfidence = barcodeGeometryConfidence({
    width: Math.max(topWidth, bottomWidth),
    height: Math.max(1, baseQuad.bottomLeft.y - baseQuad.topLeft.y),
    topWidth: topBand ? topWidth : undefined,
    bottomWidth: bottomBand ? bottomWidth : undefined,
    topCenter: topBand ? topCenter : undefined,
    bottomCenter: bottomBand ? bottomCenter : undefined,
  });

  let confidence = Math.max(
    0,
    Math.min(
      1,
      0.38 * Math.min(1, concentration / 4) +
        0.25 * Math.min(1, (strong / Math.max(1, candidateEnergy)) * 2.4) +
        0.18 * compactness +
        0.19 * geometryConfidence,
    ),
  );

  // A huge, badly shaped candidate is much more likely to be a package border/text
  // region than the barcode itself. Do not feed such a region into homography.
  const areaFraction = ((sourceX1 - sourceX0 + 1) * (sourceY1 - sourceY0 + 1)) / Math.max(1, srcW * srcH);
  if (areaFraction > 0.72 && geometryConfidence < 0.68) {
    confidence *= 0.55;
  }

  if (confidence < 0.42) {
    return {
      ...full,
      confidence,
      orientationConfidence: orientation.confidence,
      geometryConfidence,
      textureScore: concentration,
    };
  }

  const appliedRotation = orientation.rotation;
  const center = {
    x: (baseQuad.topLeft.x + baseQuad.topRight.x + baseQuad.bottomRight.x + baseQuad.bottomLeft.x) / 4,
    y: (baseQuad.topLeft.y + baseQuad.topRight.y + baseQuad.bottomRight.y + baseQuad.bottomLeft.y) / 4,
  };

  const rotatePoint = (point: BarcodePoint): BarcodePoint => {
    if (appliedRotation === 0) return point;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cosA = Math.cos(appliedRotation);
    const sinA = Math.sin(appliedRotation);
    return {
      x: Math.max(0, Math.min(srcW, center.x + dx * cosA - dy * sinA)),
      y: Math.max(0, Math.min(srcH, center.y + dx * sinA + dy * cosA)),
    };
  };

  const quad: BarcodeQuadrilateral = {
    topLeft: rotatePoint(baseQuad.topLeft),
    topRight: rotatePoint(baseQuad.topRight),
    bottomRight: rotatePoint(baseQuad.bottomRight),
    bottomLeft: rotatePoint(baseQuad.bottomLeft),
  };

  const polygonArea = Math.abs(
    (quad.topLeft.x * quad.topRight.y + quad.topRight.x * quad.bottomRight.y +
      quad.bottomRight.x * quad.bottomLeft.y + quad.bottomLeft.x * quad.topLeft.y) -
    (quad.topLeft.y * quad.topRight.x + quad.topRight.y * quad.bottomRight.x +
      quad.bottomRight.y * quad.bottomLeft.x + quad.bottomLeft.y * quad.topLeft.x),
  ) / 2;

  const quadIsUsable =
    Number.isFinite(polygonArea) &&
    polygonArea > srcW * srcH * 0.005 &&
    geometryConfidence >= 0.68;

  const cropLeft = Math.max(0, Math.floor(Math.min(quad.topLeft.x, quad.bottomLeft.x)));
  const cropTop = Math.max(0, Math.floor(Math.min(quad.topLeft.y, quad.topRight.y)));
  const cropRight = Math.min(srcW, Math.ceil(Math.max(quad.topRight.x, quad.bottomRight.x)));
  const cropBottom = Math.min(srcH, Math.ceil(Math.max(quad.bottomLeft.y, quad.bottomRight.y)));

  const safeAxisQuad: BarcodeQuadrilateral = {
    topLeft: { x: sourceX0, y: sourceY0 },
    topRight: { x: sourceX1 + 1, y: sourceY0 },
    bottomRight: { x: sourceX1 + 1, y: sourceY1 + 1 },
    bottomLeft: { x: sourceX0, y: sourceY1 + 1 },
  };

  return {
    crop: quadIsUsable
      ? {
          x: cropLeft,
          y: cropTop,
          width: Math.max(1, cropRight - cropLeft),
          height: Math.max(1, cropBottom - cropTop),
        }
      : {
          x: sourceX0,
          y: sourceY0,
          width: Math.max(1, sourceX1 - sourceX0 + 1),
          height: Math.max(1, sourceY1 - sourceY0 + 1),
        },
    quadrilateral: quadIsUsable ? quad : safeAxisQuad,
    rotation: appliedRotation,
    suggestedRotation: orientation.suggestedRotation,
    confidence,
    orientationConfidence: orientation.confidence,
    geometryConfidence,
    textureScore: concentration,
  };
}

export interface DetectOptions {
  maxDimension?: number;
  crop?: CropRect;
  variants?: readonly PreprocessVariant[];
  /** Reuse a localization already computed for the same source frame. */
  localization?: BarcodeLocalization;
  /** Internal guard preventing recursive full-frame fallback. */
  fallbackFullFrame?: boolean;
}

/**
 * Esegue la pipeline sulle varianti in ordine e restituisce gli hit affidabili.
 * Se almeno un hit supera il check GS1, filtra solo quelli (falsi positivi eliminati).
 * Altrimenti restituisce tutti gli hit "raw" così il chiamante può decidere se
 * presentarli come "da confermare" invece di scartarli silenziosamente.
 *
 * Non lancia mai: se il detector non è disponibile, o tutte le varianti falliscono,
 * restituisce [].
 */
/** Never trust the first valid numeric result: aggregate decoder variants before selection. */
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
    if ((hit.localizationConfidence ?? 0) > (current.hit.localizationConfidence ?? 0)) {
      current.hit = hit;
    }
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
      const geometry =
        hit.bounds && hit.bounds.height > 0
          ? Math.min(1, hit.bounds.width / hit.bounds.height / 7)
          : 0.35;
      const validationScore = hit.validated ? 100 : 0;
      const symbologyScore = productBarcodePriority(hit.rawValue) / 4;
      const decoderScore = Math.min(24, group.decoders.size * 12);
      const variantScore = Math.min(24, group.variants.size * 6);
      const temporalScore = Math.min(24, group.count * 4);
      const localizationScore = Math.min(16, (hit.localizationConfidence ?? 0) * 16);
      const centerScore = Math.max(0, 8 - distance * 8);
      const geometryScore = geometry * 8;
      const score =
        validationScore +
        symbologyScore +
        decoderScore +
        variantScore +
        temporalScore +
        localizationScore +
        centerScore +
        geometryScore;

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
  const detector = getDetector();
  const maxDimension = opts.maxDimension ?? 1200;
  const variants = opts.variants ?? PREPROCESS_VARIANTS;
  const localized = opts.localization ?? localizeBarcode(source, srcW, srcH);
  const useLocalizedCrop = localized.confidence >= 0.42;
  const useGeometryCorrection = canApplyBarcodeGeometry(localized);
  const crop = useLocalizedCrop ? localized.crop : opts.crop;
  const rotation = useGeometryCorrection ? localized.rotation : 0;
  const quadrilateral = useGeometryCorrection ? localized.quadrilateral : undefined;
  const nativeHits: BarcodeHit[] = [];

  if (detector) {
    for (const variant of variants) {
      try {
        const geometry = getPreprocessGeometry(srcW, srcH, variant, {
          maxDimension,
          ...(crop ? { crop } : {}),
          rotation,
          ...(quadrilateral ? { quadrilateral } : {}),
        });
        const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
          maxDimension,
          crop: geometry.crop,
          rotation,
          ...(quadrilateral ? { quadrilateral } : {}),
        });
        const codes = await detector.detect(canvas);

        for (const c of codes) {
          const hit: BarcodeHit = {
            rawValue: c.rawValue,
            variant,
            validated: isValidGs1Checksum(c.rawValue),
            decoder: "native",
            localizationConfidence: localized.confidence,
          };
          if (c.format) hit.format = c.format;

          if (c.boundingBox) {
            hit.bounds = mapOutputRectToSource(c.boundingBox, geometry);
            hit.center = {
              x: hit.bounds.x + hit.bounds.width / 2,
              y: hit.bounds.y + hit.bounds.height / 2,
            };
          }

          nativeHits.push(hit);
        }
      } catch {
        // Continue with the next variant.
      }
    }
  }

  // Browser/OS-independent fallback. This is also used when the native detector
  // exists but cannot decode a difficult frame reliably.
  const fallback = await detectWithFallback(source, srcW, srcH, {
    maxDimension,
    variants,
    ...(crop ? { crop } : {}),
    localization: localized,
  });
  let ranked = rankBarcodeHits([...nativeHits, ...fallback], srcW, srcH, crop);

  // Primary decode deliberately uses only the safe, already-approved rotation. When
  // that rotation was rejected, keep the original frame intact and optionally try the
  // raw orientation estimate as a recovery pass. This preserves straight barcodes while
  // still recovering genuinely tilted ones.
  if (
    !opts.fallbackFullFrame &&
    canApplyBarcodeGeometry(localized) &&
    localized.rotation === 0 &&
    Math.abs(localized.suggestedRotation) >= (4 * Math.PI) / 180 &&
    localized.orientationConfidence >= 0.55 &&
    !ranked.some(
      (hit) =>
        hit.validated &&
        hit.rawValue.length === 13 &&
        (hit.supportCount ?? 1) >= 2,
    )
  ) {
    const recoveredLocalization: BarcodeLocalization = {
      ...localized,
      rotation: localized.suggestedRotation,
    };
    const recovered = await detectBarcodes(source, srcW, srcH, {
      maxDimension,
      variants: ["raw", "clahe", "upscaled"],
      localization: recoveredLocalization,
      fallbackFullFrame: true,
    });
    ranked = rankBarcodeHits([...ranked, ...recovered], srcW, srcH, crop);
  }

  if (
    !opts.fallbackFullFrame &&
    localized.confidence >= 0.42 &&
    !ranked.some(
      (hit) =>
        hit.validated &&
        hit.rawValue.length === 13 &&
        (hit.supportCount ?? 1) >= 2,
    )
  ) {
    const fullLocalization: BarcodeLocalization = {
      crop: { x: 0, y: 0, width: srcW, height: srcH },
      quadrilateral: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: srcW, y: 0 },
        bottomRight: { x: srcW, y: srcH },
        bottomLeft: { x: 0, y: srcH },
      },
      rotation: 0,
      suggestedRotation: 0,
      confidence: 0,
      orientationConfidence: 0,
      geometryConfidence: 0,
      textureScore: 0,
    };
    const fullFrameHits = await detectBarcodes(source, srcW, srcH, {
      maxDimension,
      variants: ["raw", "clahe", "upscaled"],
      localization: fullLocalization,
      fallbackFullFrame: true,
    });
    return rankBarcodeHits([...ranked, ...fullFrameHits], srcW, srcH);
  }

  return ranked;
}

/**
 * Variante "one-shot": chiama detectBarcodes e restituisce il singolo hit migliore
 * (validato se esiste, altrimenti il raw più vicino al centro del crop). Utile nel
 * loop di scansione live.
 */
export function getBarcodeLocalization(source: CanvasImageSource, srcW: number, srcH: number): BarcodeLocalization {
  return localizeBarcode(source, srcW, srcH);
}

export async function detectBestBarcode(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: DetectOptions = {},
): Promise<BarcodeHit | null> {
  const hits = await detectBarcodes(source, srcW, srcH, opts);
  if (hits.length === 0) return null;

  // detectBarcodes already fuses decoder and preprocessing support. A valid EAN-13
  // with multi-decoder agreement therefore beats a checksum-valid but weak UPC-A.
  return hits
    .slice()
    .sort((a, b) => {
      const aScore =
        (a.validated ? 100 : 0) +
        a.supportCount! * 5 +
        (a.decoderSupport ?? 1) * 12 +
        (a.localizationConfidence ?? 0) * 15 +
        productBarcodePriority(a.rawValue) / 5;
      const bScore =
        (b.validated ? 100 : 0) +
        b.supportCount! * 5 +
        (b.decoderSupport ?? 1) * 12 +
        (b.localizationConfidence ?? 0) * 15 +
        productBarcodePriority(b.rawValue) / 5;
      return bScore - aScore;
    })[0] ?? null;
}



/**
 * Fallback crop used only when localization is not confident. The decoder now starts
 * from the full frame and localizes the barcode before this ROI is considered.
 */
export type ViewfinderMode = "standard" | "expanded";

export function computeViewfinderCrop(
  srcW: number,
  srcH: number,
  mode: ViewfinderMode = "standard",
): CropRect {
  // Standard ROI mirrors the on-screen guide. Expanded mode is enabled after
  // repeated good-quality/no-decode frames so a slightly misplaced barcode can
  // still be recovered without always decoding the entire sensor frame.
  const widthFraction = mode === "expanded" ? 0.94 : 0.82;
  const heightFraction = mode === "expanded" ? 0.56 : 0.38;
  const cw = srcW * widthFraction;
  const ch = srcH * heightFraction;
  return {
    x: Math.max(0, Math.round((srcW - cw) / 2)),
    y: Math.max(0, Math.round((srcH - ch) / 2)),
    width: Math.round(cw),
    height: Math.round(ch),
  };
}
