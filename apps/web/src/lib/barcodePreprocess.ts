import { isValidGs1Checksum, productBarcodePriority } from "../domain/barcode.js";
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
  const localized = localizeBarcode(source, srcW, srcH);
  const crop = localized.confidence >= 0.42 ? localized.crop : opts.crop;
  const rotation = localized.confidence >= 0.42 ? localized.rotation : 0;
  const hits: BarcodeHit[] = [];

  for (const variant of variants) {
    try {
      const geometry = getPreprocessGeometry(srcW, srcH, variant, {
        maxDimension,
        ...(crop ? { crop } : {}),
        rotation,
      });
      const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
        maxDimension,
        crop: geometry.crop,
        rotation,
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
}

export interface PreprocessGeometry {
  crop: CropRect;
  outputWidth: number;
  outputHeight: number;
  rotation: number;
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
  const scale = Math.min(1, maxDimension / Math.max(cw, ch));
  const baseW = Math.max(1, Math.round(cw * scale));
  const baseH = Math.max(1, Math.round(ch * scale));

  return {
    crop: { x: cx, y: cy, width: cw, height: ch },
    outputWidth: variant === "upscaled" ? baseW * 2 : baseW,
    outputHeight: variant === "upscaled" ? baseH * 2 : baseH,
    rotation: opts.rotation ?? 0,
  };
}

function mapOutputRectToSource(
  rect: { x: number; y: number; width: number; height: number },
  geometry: PreprocessGeometry,
): BarcodeBounds {
  return {
    x: geometry.crop.x + (rect.x / geometry.outputWidth) * geometry.crop.width,
    y: geometry.crop.y + (rect.y / geometry.outputHeight) * geometry.crop.height,
    width: (rect.width / geometry.outputWidth) * geometry.crop.width,
    height: (rect.height / geometry.outputHeight) * geometry.crop.height,
  };
}

function mapFallbackPointsToSource(
  points: unknown,
  geometry: PreprocessGeometry,
): { center?: { x: number; y: number }; bounds?: BarcodeBounds } {
  if (!Array.isArray(points) || points.length === 0) return {};

  const mapped = points
    .map((point) => {
      const candidate = point as { getX?: () => number; getY?: () => number };
      const x = candidate.getX?.();
      const y = candidate.getY?.();
      if (typeof x !== "number" || typeof y !== "number") return null;
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
  if (Math.abs(geometry.rotation) > 0.001) {
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


export interface BarcodeLocalization {
  crop: CropRect;
  rotation: number;
  confidence: number;
  textureScore: number;
}

export function localizeBarcode(source: CanvasImageSource, srcW: number, srcH: number, maxDimension = 1280): BarcodeLocalization {
  const full = { crop: { x: 0, y: 0, width: srcW, height: srcH }, rotation: 0, confidence: 0, textureScore: 0 };
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
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;

  const col = new Float64Array(w);
  const row = new Float64Array(h);
  let total = 0, strong = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 1; y < h - 1; y++) {
    const b = y * w;
    for (let x = 1; x < w - 1; x++) {
      const gx = Math.abs(gray[b + x + 1] - gray[b + x - 1]);
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      const e = Math.max(0, gx - 0.7 * gy);
      col[x] += e;
      row[y] += e;
      total += e;
      if (e > 55) {
        strong += e;
        sx += x * e; sy += y * e; sxx += x * x * e; syy += y * y * e; sxy += x * y * e;
      }
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

  const xBand = bestBand(col, (total / w) * 1.75, Math.max(24, Math.floor(w * 0.08)));
  const yBand = bestBand(row, (total / h) * 1.25, Math.max(18, Math.floor(h * 0.06)));
  if (!xBand || !yBand) return { ...full, textureScore: total / Math.max(1, w * h) };

  const varianceX = strong > 0 ? Math.max(0, sxx / strong - (sx / strong) ** 2) : 0;
  const varianceY = strong > 0 ? Math.max(0, syy / strong - (sy / strong) ** 2) : 0;
  const covariance = strong > 0 ? sxy / strong - (sx / strong) * (sy / strong) : 0;
  // The dominant axis of the edge cloud is the bar direction. For a normal
  // EAN the bars are vertical, so the desired rotation is principalAngle - PI/2.
  // This keeps an already-horizontal-in-the-image barcode at 0° instead of
  // accidentally rotating every normal barcode by 90°.
  const principalAngle = 0.5 * Math.atan2(2 * covariance, varianceX - varianceY);
  let rotation = principalAngle - Math.PI / 2;
  while (rotation > Math.PI / 2) rotation -= Math.PI;
  while (rotation < -Math.PI / 2) rotation += Math.PI;
  rotation = Math.max(-0.35, Math.min(0.35, rotation));

  const padX = Math.max(18, Math.round((xBand.end - xBand.start + 1) * 0.22));
  const padY = Math.max(16, Math.round((yBand.end - yBand.start + 1) * 0.65));
  let x0 = Math.max(0, xBand.start - padX), x1 = Math.min(w - 1, xBand.end + padX);
  let y0 = Math.max(0, yBand.start - padY), y1 = Math.min(h - 1, yBand.end + padY);
  const areaFraction = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (w * h);
  const concentration = (xBand.score / Math.max(1, total / w)) * (yBand.score / Math.max(1, total / h));
  const confidence = Math.max(0, Math.min(1,
    0.45 * Math.min(1, concentration / 4) +
    0.35 * Math.min(1, (strong / Math.max(1, total)) * 3) +
    0.20 * (1 - Math.min(1, areaFraction)),
  ));
  if (confidence < 0.42 || areaFraction > 0.78) return { ...full, confidence, textureScore: concentration };

  const inv = 1 / scale;
  x0 = Math.floor(x0 * inv); x1 = Math.min(srcW - 1, Math.ceil((x1 + 1) * inv) - 1);
  y0 = Math.floor(y0 * inv); y1 = Math.min(srcH - 1, Math.ceil((y1 + 1) * inv) - 1);
  return {
    crop: { x: Math.max(0, x0), y: Math.max(0, y0), width: Math.max(1, x1 - x0 + 1), height: Math.max(1, y1 - y0 + 1) },
    rotation,
    confidence,
    textureScore: concentration,
  };
}

export interface DetectOptions {
  maxDimension?: number;
  crop?: CropRect;
  variants?: readonly PreprocessVariant[];
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
  const groups = new Map<string, { hit: BarcodeHit; count: number }>();
  for (const hit of hits) {
    const current = groups.get(hit.rawValue);
    if (current) current.count += 1;
    else groups.set(hit.rawValue, { hit, count: 1 });
  }
  const cx = crop ? crop.x + crop.width / 2 : srcW / 2;
  const cy = crop ? crop.y + crop.height / 2 : srcH / 2;
  const extent = Math.max(srcW, srcH);
  return [...groups.values()].sort((a, b) => {
    const score = (entry: {hit: BarcodeHit; count: number}) => {
      const validity = entry.hit.validated ? 10000 : 0;
      const symbology = productBarcodePriority(entry.hit.rawValue);
      const distance = entry.hit.center ? Math.hypot(entry.hit.center.x-cx, entry.hit.center.y-cy)/extent : 1;
      return validity + symbology + entry.count*50 - distance*100;
    };
    return score(b) - score(a);
  }).map((entry) => entry.hit);
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
  const localized = localizeBarcode(source, srcW, srcH);
  const crop = localized.confidence >= 0.42 ? localized.crop : opts.crop;
  const rotation = localized.confidence >= 0.42 ? localized.rotation : 0;
  const nativeHits: BarcodeHit[] = [];

  if (detector) {
    for (const variant of variants) {
      try {
        const geometry = getPreprocessGeometry(srcW, srcH, variant, {
          maxDimension,
          ...(crop ? { crop } : {}),
          rotation,
        });
        const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
          maxDimension,
          crop: geometry.crop,
          rotation,
        });
        const codes = await detector.detect(canvas);

        for (const c of codes) {
          const hit: BarcodeHit = {
            rawValue: c.rawValue,
            variant,
            validated: isValidGs1Checksum(c.rawValue),
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
  });
  return rankBarcodeHits([...nativeHits, ...fallback], srcW, srcH, crop);
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

  // Priorità: validati > raw; a parità, più vicino al centro del crop/immagine.
  const cx = opts.crop ? opts.crop.x + opts.crop.width / 2 : srcW / 2;
  const cy = opts.crop ? opts.crop.y + opts.crop.height / 2 : srcH / 2;

  const sorted = [...hits].sort((a, b) => {
    if (a.validated !== b.validated) return a.validated ? -1 : 1;
    const da = a.center ? Math.hypot(a.center.x - cx, a.center.y - cy) : Infinity;
    const db = b.center ? Math.hypot(b.center.x - cx, b.center.y - cy) : Infinity;
    return da - db;
  });
  return sorted[0] ?? null;
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
