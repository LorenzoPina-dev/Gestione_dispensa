import { isValidGs1Checksum } from "../domain/barcode.js";
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
  const hits: BarcodeHit[] = [];

  for (const variant of variants) {
    try {
      const geometry = getPreprocessGeometry(srcW, srcH, variant, {
        maxDimension,
        ...(opts.crop ? { crop: opts.crop } : {}),
      });
      const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
        maxDimension,
        crop: geometry.crop,
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
      if (hit.validated) return [hit];
    } catch {
      // No barcode in this variant; continue with the next preprocessing pass.
    }
  }

  const validated = hits.filter((hit) => hit.validated);
  return validated.length > 0 ? validated : hits;
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
  const maxDimension = opts.maxDimension ?? 800;
  const scale = Math.min(1, maxDimension / Math.max(cw, ch));
  const baseW = Math.max(1, Math.round(cw * scale));
  const baseH = Math.max(1, Math.round(ch * scale));

  return {
    crop: { x: cx, y: cy, width: cw, height: ch },
    outputWidth: variant === "upscaled" ? baseW * 2 : baseW,
    outputHeight: variant === "upscaled" ? baseH * 2 : baseH,
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
  ctx.drawImage(source, cx, cy, cw, ch, 0, 0, outW, outH);

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
export async function detectBarcodes(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: DetectOptions = {},
): Promise<BarcodeHit[]> {
  const detector = getDetector();
  const maxDimension = opts.maxDimension ?? 1200;
  const variants = opts.variants ?? PREPROCESS_VARIANTS;
  const crop = opts.crop;
  const nativeHits: BarcodeHit[] = [];

  if (detector) {
    for (const variant of variants) {
      try {
        const geometry = getPreprocessGeometry(srcW, srcH, variant, {
          maxDimension,
          ...(crop ? { crop } : {}),
        });
        const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
          maxDimension,
          crop: geometry.crop,
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
          if (hit.validated) return [hit];
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
  if (fallback.length > 0) return fallback;

  const validatedNative = nativeHits.filter((hit) => hit.validated);
  return validatedNative.length > 0 ? validatedNative : nativeHits;
}

/**
 * Variante "one-shot": chiama detectBarcodes e restituisce il singolo hit migliore
 * (validato se esiste, altrimenti il raw più vicino al centro del crop). Utile nel
 * loop di scansione live.
 */
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
 * Calcola il ritaglio del mirino (regione centrale ~82% × 38%) in coordinate sorgente.
 * Il mirino nell'UI usa le stesse proporzioni, così la regione mostrata all'utente
 * coincide con la regione passata al decoder.
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
