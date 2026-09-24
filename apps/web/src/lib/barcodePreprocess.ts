// apps/web/src/lib/barcodePreprocess.ts
//
// Preprocessing adattivo per la scansione barcode: grayscale, equalizzazione
// dell'istogramma, gamma correction, Bradley adaptive threshold, unsharp mask.
// Pensato per essere chiamato sia su frame video (loop live) che su foto caricate.
//
// Il detector nativo BarcodeDetector funziona discretamente su immagini "pulite",
// ma su plastica lucida / luce non uniforme / messa a fuoco morbida sbaglia o non
// trova nulla. Generando più varianti preprocessate in parallelo e passandole tutte
// al detector, la probabilità di lettura sale drasticamente — anche di 10-20× nei
// casi difficili.

export type PreprocessVariant = "raw" | "equalized" | "bradley" | "upscaled";

/** Ordine di esecuzione: prima le varianti più economiche, ma tutte partono in parallelo. */
export const PREPROCESS_VARIANTS: readonly PreprocessVariant[] = [
  "raw",
  "equalized",
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
  const crop: CropRect = opts.crop ?? { x: 0, y: 0, width: srcW, height: srcH };
  const maxDimension = opts.maxDimension ?? 800;

  // Clamp del crop ai bordi: drawImage con rect fuori bounds è undefined-behaviour.
  const cx = Math.max(0, Math.min(crop.x, srcW - 1));
  const cy = Math.max(0, Math.min(crop.y, srcH - 1));
  const cw = Math.max(1, Math.min(crop.width, srcW - cx));
  const ch = Math.max(1, Math.min(crop.height, srcH - cy));

  const scale = Math.min(1, maxDimension / Math.max(cw, ch));
  const baseW = Math.max(1, Math.round(cw * scale));
  const baseH = Math.max(1, Math.round(ch * scale));
  // La variante "upscaled" raddoppia il lato: utile quando il barcode occupa pochi
  // pixel (foto da lontano, mirino piccolo). Unsharp mask poi recupera i bordi.
  const outW = variant === "upscaled" ? baseW * 2 : baseW;
  const outH = variant === "upscaled" ? baseH * 2 : baseH;

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
      applyGamma(gray, 1.15); // solleva le ombre di ~15%
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
export function isValidGs1Checksum(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (value.length !== 8 && value.length !== 12 && value.length !== 13 && value.length !== 14) {
    return false;
  }
  let sum = 0;
  let weight = 3;
  for (let i = value.length - 2; i >= 0; i--) {
    sum += Number(value[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(value[value.length - 1]);
}

// ── API di alto livello ───────────────────────────────────────────────────────

export interface DetectOptions {
  maxDimension?: number;
  crop?: CropRect;
  variants?: readonly PreprocessVariant[];
}

/**
 * Esegue la pipeline su tutte le varianti in parallelo e restituisce tutti gli hit.
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
  if (!detector) return [];

  const maxDimension = opts.maxDimension ?? 800;
  const variants = opts.variants ?? PREPROCESS_VARIANTS;
  const crop = opts.crop;

  const runs = await Promise.all(
    variants.map(async (variant): Promise<BarcodeHit[]> => {
      try {
        const canvas = preprocessToCanvas(source, srcW, srcH, variant, {
          maxDimension,
          ...(crop ? { crop } : {}),
        });
        const codes = await detector.detect(canvas);
        return codes.map((c) => {
          const hit: BarcodeHit = {
            rawValue: c.rawValue,
            variant,
            validated: isValidGs1Checksum(c.rawValue),
          };
          if (c.format) hit.format = c.format;
          if (c.boundingBox && crop) {
            hit.center = {
              x: crop.x + c.boundingBox.x + c.boundingBox.width / 2,
              y: crop.y + c.boundingBox.y + c.boundingBox.height / 2,
            };
          } else if (c.boundingBox) {
            hit.center = {
              x: c.boundingBox.x + c.boundingBox.width / 2,
              y: c.boundingBox.y + c.boundingBox.height / 2,
            };
          }
          return hit;
        });
      } catch {
        return [];
      }
    }),
  );

  const all = runs.flat();
  const validated = all.filter((h) => h.validated);
  return validated.length > 0 ? validated : all;
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
 * Calcola il ritaglio del mirino (regione centrale ~60% × 35%) in coordinate sorgente.
 * Il mirino nell'UI è un rettangolo orizzontale largo circa il 60% della viewport e
 * alto il 35% — questa funzione approssima quella stessa area sul frame video.
 */
export function computeViewfinderCrop(srcW: number, srcH: number): CropRect {
  const cw = srcW * 0.6;
  const ch = srcH * 0.35;
  return {
    x: Math.max(0, Math.round((srcW - cw) / 2)),
    y: Math.max(0, Math.round((srcH - ch) / 2)),
    width: Math.round(cw),
    height: Math.round(ch),
  };
}