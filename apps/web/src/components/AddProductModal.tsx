import { useCallback, useEffect, useRef, useState } from "react";
import type { StockItem, StorageLocation } from "../types";
import type { ProductDto } from "../api/types";
import * as api from "../api/endpoints";
import { computeViewfinderCrop, detectBestBarcode, preprocessToCanvas, type BarcodeHit, type PreprocessVariant } from "../lib/barcodePreprocess";
import { detectBarcodeRoi } from "../lib/barcodeRoi";
import { analyzeBarcodeFrame } from "../lib/barcodeQuality";
import { barcodeObservationsAgree, consensusRequiredFrames, type FrameQualityResult } from "../domain/barcode-scanner.js";
import { normalizeProductBarcode, productBarcodePriority } from "../domain/barcode.js";
import { increaseBarcodeZoom, openBarcodeCamera, readCameraDiagnostics, recoverBarcodeFocus, setBarcodeTorch, type CameraDiagnostics } from "../lib/barcodeCamera";
import { isBackendUnreachable } from "../api/client.js";

type AddMode = "menu" | "barcode" | "manuale" | "lista";
type BarcodeState = "IDLE" | "SCANNING" | "LOOKING" | "CANDIDATE" | "CONFIRMED" | "MANUAL_REQUIRED" | "NOT_FOUND" | "DEGRADED";

const LOCATIONS: { key: StorageLocation; label: string; icon: string }[] = [
  { key: "frigo", label: "Frigo", icon: "❄️" },
  { key: "freezer", label: "Freezer", icon: "🧊" },
  { key: "dispensa", label: "Dispensa", icon: "🏺" },
  { key: "altro", label: "Altro", icon: "📦" },
];

interface Props {
  onClose: () => void;
  onAdd: (item: Omit<StockItem, "id" | "version" | "provenance">) => void;
}

type Candidate = {
  productId: string;
  name: string;
  brand?: string;
  unit: StockItem["unit"];
  category?: string;
  photoUrl?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  quantityValue?: number;
  quantityUnit?: string;
  quantityLabel?: string;
  servingSize?: string;
  servingQuantity?: number;
  servingUnit?: string;
  images?: {
    front?: string;
    frontSmall?: string;
    frontThumb?: string;
    ingredients?: string;
    ingredientsSmall?: string;
    ingredientsThumb?: string;
    nutrition?: string;
    nutritionSmall?: string;
    nutritionThumb?: string;
    packaging?: string;
    packagingSmall?: string;
    packagingThumb?: string;
  };
  openFoodFacts?: Record<string, unknown>;
  provenanceQuality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
};

function candidateFromProduct(p: ProductDto): Candidate {
  return {
    productId: p.id,
    name: p.canonicalName || `Prodotto ${p.id?.slice(0, 8) || ""}`,
    brand: p.brand,
    unit: (p.defaultUnit || p.quantityUnit || "piece") as StockItem["unit"],
    category: p.category,
    photoUrl: p.photoUrl,
    calories: p.calories,
    protein: p.protein,
    carbs: p.carbs,
    fat: p.fat,
    fiber: p.fiber,
    quantityValue: p.quantityValue,
    quantityUnit: p.quantityUnit,
    quantityLabel: p.quantityLabel,
    servingSize: p.servingSize,
    servingQuantity: p.servingQuantity,
    servingUnit: p.servingUnit,
    images: p.images,
    openFoodFacts: p.openFoodFacts,
    provenanceQuality: p.provenanceQuality,
  };
}

function defaultPackageCount(_candidate: Candidate): string {
  return "1";
}

function normalizePackageUnit(value: string | undefined): StockItem["unit"] | null {
  const unit = String(value ?? "").trim().toLowerCase();
  if (unit === "g" || unit === "kg" || unit === "ml" || unit === "l" || unit === "piece" || unit === "pack") {
    return unit;
  }
  return null;
}

function packageCountToStock(
  candidate: Candidate,
  packageCount: number,
): { quantity: number; unit: StockItem["unit"] } {
  const packageUnit = normalizePackageUnit(candidate.quantityUnit);

  if (
    candidate.quantityValue != null &&
    Number.isFinite(candidate.quantityValue) &&
    candidate.quantityValue > 0 &&
    packageUnit !== null
  ) {
    return {
      quantity: Math.round(candidate.quantityValue * packageCount * 1000) / 1000,
      unit: packageUnit,
    };
  }

  // Nessuna pezzatura affidabile: non inventiamo grammi/ml. Conserviamo esplicitamente
  // il numero di confezioni e lasciamo al catalogo/nutrizione il valore come non convertibile.
  return {
    quantity: packageCount,
    unit: "pack",
  };
}

export default function AddProductModal({ onClose, onAdd }: Props) {
  const [mode, setMode] = useState<AddMode>("menu");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: "rgba(26,21,16,.48)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden" style={{ backgroundColor: "#f5f0e8", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {mode === "menu" && <ModeMenu onSelect={setMode} onClose={onClose} />}
        {mode === "barcode" && <BarcodeFlow onAdd={onAdd} onBack={() => setMode("menu")} />}
        {mode === "manuale" && <ManualForm onAdd={onAdd} onBack={() => setMode("menu")} />}
        {mode === "lista" && <ImportList onAdd={onAdd} onBack={() => setMode("menu")} />}
      </div>
    </div>
  );
}

function ModeMenu({ onSelect, onClose }: { onSelect: (m: AddMode) => void; onClose: () => void }) {
  const modes = [
    { key: "barcode" as const, icon: "📷", label: "Foto / scansione barcode", desc: "Scatta una foto, carica un'immagine oppure usa la fotocamera" },
    { key: "manuale" as const, icon: "✏️", label: "Cerca prodotto per nome", desc: "Scrivi il nome e scegli il prodotto da Open Food Facts" },
    { key: "lista" as const, icon: "📋", label: "Importa lista", desc: "Aggiungi più prodotti manualmente" },
  ];
  return (
    <div className="p-4 space-y-5 sm:p-6">
      <div className="flex items-center justify-between"><h3 className="text-xl font-light" style={{ color: "#1a1510" }}>Aggiungi prodotto</h3><button onClick={onClose} className="w-8 h-8 rounded-full" style={{ backgroundColor: "#ede6d6" }}>×</button></div>
      <div className="space-y-2">
        {modes.map((m) => <button key={m.key} onClick={() => onSelect(m.key)} className="w-full flex items-center gap-4 p-4 rounded-2xl text-left" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}><span className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl" style={{ backgroundColor: "#f0ddd5" }}>{m.icon}</span><div><p className="text-sm font-semibold" style={{ color: "#1a1510" }}>{m.label}</p><p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>{m.desc}</p></div><span className="ml-auto" style={{ color: "#d8cfc0" }}>›</span></button>)}
      </div>
    </div>
  );
}

function BarcodeFlow({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) {
  type ScannerPhase = "IDLE" | "INITIALIZING" | "FOCUS_SETTLING" | "QUALITY_CHECK" | "DECODING" | "VERIFYING" | "RECOVERING";

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const frameRequestRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const stoppedRef = useRef(false);
  const previousFingerprintRef = useRef<Uint8Array | undefined>(undefined);
  type TemporalBarcodeVote = {
    value: string;
    hit: BarcodeHit;
    at: number;
  };
  const consensusRef = useRef<TemporalBarcodeVote[]>([]);
  const poorFrameCountRef = useRef(0);
  const goodNoHitFramesRef = useRef(0);
  const lastRecoveryAtRef = useRef(0);
  const zoomBoostedRef = useRef(false);
  const expandedViewfinderRef = useRef(false);
  const preprocessPreviewCanvasRefs = useRef<Partial<Record<PreprocessVariant, HTMLCanvasElement | null>>>({});
  const previewTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<BarcodeState>("IDLE");
  const [scannerPhase, setScannerPhase] = useState<ScannerPhase>("IDLE");
  const [scannerMessage, setScannerMessage] = useState("Posiziona il barcode nel riquadro.");
  const [frameQuality, setFrameQuality] = useState<FrameQualityResult | null>(null);
  const [expandedViewfinder, setExpandedViewfinder] = useState(false);
  const [code, setCode] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [expiry, setExpiry] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");
  const [reorderQuantity, setReorderQuantity] = useState("1");
  const [location, setLocation] = useState<StorageLocation>("dispensa");
  const [cameraDiagnostics, setCameraDiagnostics] = useState<CameraDiagnostics | null>(null);
  const [cameraAspectRatio, setCameraAspectRatio] = useState("16/9");
  const [showPreprocessPreview, setShowPreprocessPreview] = useState(true);
  const [previewUpdatedAt, setPreviewUpdatedAt] = useState(0);
  const [localization, setLocalization] = useState<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null);
  const previewVariants: readonly PreprocessVariant[] = ["raw", "equalized", "clahe", "sauvola", "bradley", "upscaled"];

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraDiagnostics(null);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const video = videoRef.current as (HTMLVideoElement & { cancelVideoFrameCallback?: (handle: number) => void }) | null;
    if (frameRequestRef.current !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(frameRequestRef.current);
    }
    frameRequestRef.current = null;
    scanBusyRef.current = false;
    previousFingerprintRef.current = undefined;
    consensusRef.current = [];
    poorFrameCountRef.current = 0;
    goodNoHitFramesRef.current = 0;
    lastRecoveryAtRef.current = 0;
    zoomBoostedRef.current = false;
    expandedViewfinderRef.current = false;
    setExpandedViewfinder(false);
    setFrameQuality(null);
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    setPreviewUpdatedAt(0);
    setScannerPhase("IDLE");
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && !stoppedRef.current) {
        stopCamera();
        setState("IDLE");
        setError("Scansione sospesa perché la pagina è passata in background.");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [stopCamera]);

  async function resolve(codeValue: string) {
    const normalized = normalizeProductBarcode(codeValue);
    if (!normalized) {
      setCode(codeValue.trim());
      setError("Inserisci un codice prodotto EAN/UPC/GTIN valido.");
      setState("MANUAL_REQUIRED");
      return;
    }
    setCode(normalized);
    setError(null);
    setState("LOOKING");
    try {
      const result = await api.resolveProductBarcode("BARCODE", normalized);
      if (result.status === "MATCHED" && result.product) {
        const p = result.product;
        const resolvedCandidate = candidateFromProduct(p);
        setCandidate(resolvedCandidate);
        setQty(defaultPackageCount(resolvedCandidate));
        setReorderQuantity(defaultPackageCount(resolvedCandidate));
        setState("CANDIDATE");
        return;
      }
      if (result.status === "DEGRADED") {
        setError("Il catalogo esterno non ha risposto. Puoi riprovare oppure inserire il prodotto manualmente.");
        setState("DEGRADED");
        return;
      }
      setState("NOT_FOUND");
    } catch (err) {
      setError(isBackendUnreachable(err) ? "Impossibile contattare il server." : "Errore durante la ricerca del prodotto.");
      setState("DEGRADED");
    }
  }

  async function scanSource(source: CanvasImageSource, width: number, height: number) {
    setState("LOOKING");
    try {
      const hit: BarcodeHit | null = await detectBestBarcode(source, width, height, { maxDimension: 1600 });
      if (!hit) { setError("Nessun barcode leggibile nell'immagine."); setState("MANUAL_REQUIRED"); return; }
      const normalized = normalizeProductBarcode(hit.rawValue);
      if (!normalized) {
        setCode(hit.rawValue);
        setError("Il barcode rilevato non è un codice prodotto EAN/UPC/GTIN.");
        setState("MANUAL_REQUIRED");
        return;
      }
      await resolve(normalized);
    } catch (err) {
      console.error("[barcode] image scan failed", err);
      setError("Non è stato possibile leggere il barcode dall'immagine.");
      setState("MANUAL_REQUIRED");
    }
  }

  function qualityMessage(metrics: FrameQualityResult, noHitFrames: number): string {
    if (metrics.advice === "STEADY") return "Mantieni fermo il dispositivo.";
    if (metrics.advice === "FOCUS") return "Attendi la messa a fuoco o avvicinati lentamente.";
    if (metrics.advice === "GLARE") return "Evita i riflessi: inclina leggermente la confezione.";
    if (metrics.advice === "LIGHT") return "C'è poca luce. Attiva la luce della fotocamera.";
    if (noHitFrames >= 4) return "Avvicina il barcode e riempi il riquadro.";
    return "Inquadra le barre nel riquadro.";
  }

  async function recoverCamera(track: MediaStreamTrack) {
    const now = performance.now();
    if (now - lastRecoveryAtRef.current < 1800) return;
    lastRecoveryAtRef.current = now;
    setScannerPhase("RECOVERING");
    setScannerMessage("Rimetto a fuoco la fotocamera…");
    const diagnostics = await recoverBarcodeFocus(track);
    if (!stoppedRef.current) {
      setCameraDiagnostics(diagnostics);
      setScannerPhase("QUALITY_CHECK");
    }
  }

  const updatePreprocessPreview = useCallback(async () => {
    if (stoppedRef.current || !showPreprocessPreview) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      previewTimerRef.current = window.setTimeout(() => void updatePreprocessPreview(), 300);
      return;
    }

    try {
      const roi = await detectBarcodeRoi(video, video.videoWidth, video.videoHeight, {
        fallbackCrop: computeViewfinderCrop(
          video.videoWidth,
          video.videoHeight,
          expandedViewfinderRef.current ? "expanded" : "standard",
        ),
      });
      setLocalization({ ...roi.crop, confidence: roi.confidence });

      for (const variant of previewVariants) {
        const output = preprocessPreviewCanvasRefs.current[variant];
        if (!output) continue;
        const processed = preprocessToCanvas(video, video.videoWidth, video.videoHeight, variant, {
          maxDimension: 720,
          crop: roi.crop,
        });
        output.width = processed.width;
        output.height = processed.height;
        const ctx = output.getContext("2d");
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        ctx.drawImage(processed, 0, 0);
      }

      setPreviewUpdatedAt(performance.now());
    } catch (err) {
      console.debug("[barcode] preprocess comparison preview failed", err);
    } finally {
      if (!stoppedRef.current && showPreprocessPreview) {
        previewTimerRef.current = window.setTimeout(() => void updatePreprocessPreview(), 300);
      }
    }
  }, [showPreprocessPreview]);
  useEffect(() => {
    if (state !== "SCANNING" || !showPreprocessPreview) return;
    previewTimerRef.current = window.setTimeout(updatePreprocessPreview, 100);
    return () => {
      if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    };
  }, [state, showPreprocessPreview, expandedViewfinder, updatePreprocessPreview]);

  async function scanFrame() {
    if (stoppedRef.current || scanBusyRef.current) return;

    const now = performance.now();
    if (now - lastScanAtRef.current < 90) {
      scheduleScan();
      return;
    }

    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      scheduleScan();
      return;
    }

    scanBusyRef.current = true;
    lastScanAtRef.current = now;

    try {
      const cropMode = expandedViewfinderRef.current ? "expanded" : "standard";
      const roi = await detectBarcodeRoi(video, video.videoWidth, video.videoHeight, {
        fallbackCrop: computeViewfinderCrop(video.videoWidth, video.videoHeight, cropMode),
      });
      const activeCrop = roi.crop;
      setLocalization({ ...activeCrop, confidence: roi.confidence });

      const sample = analyzeBarcodeFrame(
        video,
        video.videoWidth,
        video.videoHeight,
        activeCrop,
        previousFingerprintRef.current,
      );

      if (sample) {
        previousFingerprintRef.current = sample.fingerprint;
        setFrameQuality(sample.metrics);
        setScannerPhase("QUALITY_CHECK");
      }

      const metrics = sample?.metrics;
      if (metrics) {
        if (metrics.quality === "poor") poorFrameCountRef.current++;
        else poorFrameCountRef.current = 0;

        setScannerMessage(qualityMessage(metrics, goodNoHitFramesRef.current));

        if (
          metrics.quality === "poor" &&
          poorFrameCountRef.current >= 4 &&
          performance.now() - lastRecoveryAtRef.current >= 1800
        ) {
          await recoverCamera(track);
          return;
        }

        // Motion-heavy frames are not useful for a decoder. For other poor frames
        // we still sample every third frame because thresholding can recover glare.
        if (
          metrics.quality === "poor" &&
          (metrics.motion > 0.28 || poorFrameCountRef.current % 3 !== 0)
        ) {
          return;
        }
      }

      setScannerPhase("DECODING");
      const quality = metrics?.quality ?? "usable";
      const variants: readonly PreprocessVariant[] =
        quality === "good"
          ? ["raw", "equalized", "clahe", "upscaled"]
          : quality === "usable"
            ? ["raw", "equalized", "clahe", "sauvola", "bradley", "upscaled"]
            : ["raw", "upscaled", "clahe", "sauvola", "bradley", "equalized"];
      const hit = await detectBestBarcode(
        video,
        video.videoWidth,
        video.videoHeight,
        {
          maxDimension: Math.min(1440, Math.max(video.videoWidth, video.videoHeight)),
          crop: activeCrop,
          variants,
        },
      );
      if (stoppedRef.current) return;

      if (!hit) {
        if (metrics?.quality === "good") {
          goodNoHitFramesRef.current++;
          if (goodNoHitFramesRef.current === 5) {
            expandedViewfinderRef.current = true;
            setExpandedViewfinder(true);
          } else if (
            goodNoHitFramesRef.current >= 9 &&
            !zoomBoostedRef.current
          ) {
            const diagnostics = await increaseBarcodeZoom(track);
            // Mark the recovery as attempted even when the device is already at max zoom,
            // otherwise the same constraint call would be repeated on every frame.
            zoomBoostedRef.current = true;
            setCameraDiagnostics(diagnostics);
          }
        } else {
          goodNoHitFramesRef.current = 0;
        }
        setScannerPhase("QUALITY_CHECK");
        return;
      }

      goodNoHitFramesRef.current = 0;
      if (hit.bounds) {
        setLocalization({
          ...hit.bounds,
          confidence: hit.localizationConfidence ?? 0.5,
        });
      }
      const normalized = normalizeProductBarcode(hit.rawValue);
      if (!normalized) {
        consensusRef.current = [];
        setScannerPhase("QUALITY_CHECK");
        return;
      }

      const validated = /^[0-9]+$/.test(normalized) && normalized.length >= 8
        ? hit.validated
        : false;
      const observation = {
        value: normalized,
        ...(hit.center ? { center: hit.center } : {}),
        ...(hit.bounds ? { bounds: hit.bounds } : {}),
      };

      setScannerPhase("VERIFYING");
      const nowVote = performance.now();
      const windowMs = 2400;
      const activeVotes = consensusRef.current.filter((vote) => nowVote - vote.at <= windowMs);
      const previousVote = activeVotes[activeVotes.length - 1];
      const consecutiveVotes =
        previousVote && previousVote.value !== normalized
          ? []
          : activeVotes;
      const nextVotes = [...consecutiveVotes, { value: normalized, hit, at: nowVote }].slice(-12);
      consensusRef.current = nextVotes;

      const groups = new Map<string, {
        votes: TemporalBarcodeVote[];
        count: number;
        best: BarcodeHit;
        decoders: Set<string>;
        variants: Set<string>;
      }>();
      for (const vote of nextVotes) {
        const group = groups.get(vote.value);
        if (!group) {
          groups.set(vote.value, {
            votes: [vote],
            count: 1,
            best: vote.hit,
            decoders: new Set([vote.hit.decoder]),
            variants: new Set([vote.hit.variant]),
          });
          continue;
        }
        group.votes.push(vote);
        group.count += 1;
        group.decoders.add(vote.hit.decoder);
        group.variants.add(vote.hit.variant);
        if (
          (vote.hit.validated && !group.best.validated) ||
          (vote.hit.supportCount ?? 0) > (group.best.supportCount ?? 0)
        ) {
          group.best = vote.hit;
        }
      }

      const ranked = [...groups.entries()].sort((a, b) => {
        const score = (entry: {
          count: number;
          best: BarcodeHit;
          decoders: Set<string>;
          variants: Set<string>;
        }) =>
          entry.count * 12 +
          (entry.best.validated ? 100 : 0) +
          Math.min(24, (entry.best.supportCount ?? 1) * 6) +
          entry.decoders.size * 10 +
          entry.variants.size * 3 +
          (entry.best.localizationConfidence ?? 0) * 15 +
          productBarcodePriority(entry.best.rawValue) / 5;
        return score(b[1]) - score(a[1]);
      });

      const winner = ranked[0]?.[1];
      if (winner) {
        const first = winner.votes[0];
        const spatialCount = first
          ? winner.votes.filter((vote) =>
              barcodeObservationsAgree(
                {
                  value: vote.value,
                  ...(vote.hit.center ? { center: vote.hit.center } : {}),
                  ...(vote.hit.bounds ? { bounds: vote.hit.bounds } : {}),
                },
                {
                  value: first.value,
                  ...(first.hit.center ? { center: first.hit.center } : {}),
                  ...(first.hit.bounds ? { bounds: first.hit.bounds } : {}),
                },
                video.videoWidth,
                video.videoHeight,
              ),
            ).length
          : 0;
        const required = consensusRequiredFrames(winner.best.validated, quality);
        const threeFrameConfirmation =
          winner.best.validated &&
          winner.count >= required &&
          spatialCount >= 2;

        const lastTwo = winner.votes.slice(-2);
        const fastSpatialCount = lastTwo.length === 2
          ? lastTwo.filter((vote) =>
              barcodeObservationsAgree(
                {
                  value: vote.value,
                  ...(vote.hit.center ? { center: vote.hit.center } : {}),
                  ...(vote.hit.bounds ? { bounds: vote.hit.bounds } : {}),
                },
                {
                  value: lastTwo[0].value,
                  ...(lastTwo[0].hit.center ? { center: lastTwo[0].hit.center } : {}),
                  ...(lastTwo[0].hit.bounds ? { bounds: lastTwo[0].hit.bounds } : {}),
                },
                video.videoWidth,
                video.videoHeight,
              ),
            ).length
          : 0;

        const fastTwoFrameConfirmation =
          winner.best.validated &&
          lastTwo.length === 2 &&
          lastTwo[1].at - lastTwo[0].at <= 420 &&
          lastTwo.every(
            (vote) =>
              vote.hit.validated &&
              (vote.hit.supportCount ?? 0) >= 2,
          ) &&
          fastSpatialCount === 2;

        if (winner.best.validated && (threeFrameConfirmation || fastTwoFrameConfirmation)) {
          const found = winner.best.rawValue;
          setScannerMessage("Barcode verificato. Cerco il prodotto…");
          stopCamera();
          await resolve(found);
          return;
        }
      }
    } catch {
      // Camera decoding is best-effort; acquisition remains alive.
    } finally {
      scanBusyRef.current = false;
      if (!stoppedRef.current) scheduleScan();
    }
  }

  function scheduleScan() {
    if (stoppedRef.current) return;
    const video = videoRef.current as (HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => number | void) => number;
    }) | null;
    if (!video) return;

    if (video.requestVideoFrameCallback) {
      frameRequestRef.current = video.requestVideoFrameCallback(() => {
        void scanFrame();
      });
      return;
    }

    timerRef.current = window.setTimeout(() => {
      void scanFrame();
    }, 90);
  }

  async function startCamera() {
    setState("SCANNING");
    setScannerPhase("INITIALIZING");
    setScannerMessage("Apro la fotocamera…");
    setError(null);
    stoppedRef.current = false;
    setCameraDiagnostics(null);
    setFrameQuality(null);

    try {
      const { stream, track, diagnostics } = await openBarcodeCamera();
      if (stoppedRef.current) {
        stream.getTracks().forEach((item) => item.stop());
        return;
      }

      streamRef.current = stream;
      setCameraDiagnostics(diagnostics);

      track.addEventListener("ended", () => {
        if (stoppedRef.current) return;
        stopCamera();
        setError("La fotocamera si è disconnessa. Riavvia la scansione.");
        setState("IDLE");
      });

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((item) => item.stop());
        streamRef.current = null;
        setState("IDLE");
        return;
      }

      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      if (video.videoWidth && video.videoHeight) {
        setCameraAspectRatio(`${video.videoWidth}/${video.videoHeight}`);
      }

      setScannerPhase("FOCUS_SETTLING");
      setScannerMessage("Stabilizzo autofocus e immagine…");
      await new Promise((resolveTimer) => window.setTimeout(resolveTimer, 350));
      if (stoppedRef.current) return;

      setCameraDiagnostics(readCameraDiagnostics(track));
      setScannerPhase("QUALITY_CHECK");
      setScannerMessage("Posiziona il barcode nel riquadro.");
      scheduleScan();
    } catch (err) {
      stopCamera();
      setError(
        err instanceof Error && err.message === "camera_not_supported"
          ? "Questo browser non consente l'accesso alla fotocamera."
          : "Impossibile accedere alla fotocamera. Controlla i permessi del browser.",
      );
      setState("IDLE");
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !cameraDiagnostics?.torchSupported) return;
    const diagnostics = await setBarcodeTorch(track, !cameraDiagnostics.torchEnabled);
    setCameraDiagnostics(diagnostics);
  }

  function confirmCandidate() {
    if (!candidate) return;
    setState("CONFIRMED");
  }

  function save() {
    if (!candidate) return;

    const packageCount = Number(qty);
    if (!Number.isInteger(packageCount) || packageCount <= 0) {
      setError("La quantità deve essere un numero intero di confezioni maggiore di zero.");
      return;
    }

    const stockQuantity = packageCountToStock(candidate, packageCount);
    const parsedReorderPoint = reorderPoint.trim() === "" ? undefined : Number(reorderPoint);
    if (parsedReorderPoint !== undefined && (!Number.isFinite(parsedReorderPoint) || parsedReorderPoint < 0)) {
      setError("La soglia di riordino deve essere un numero maggiore o uguale a zero.");
      return;
    }
    const reorderPackageCount = reorderQuantity.trim() === "" ? 1 : Number(reorderQuantity);
    if (!Number.isInteger(reorderPackageCount) || reorderPackageCount <= 0) {
      setError("La quantità da riacquistare deve essere un numero intero di confezioni maggiore di zero.");
      return;
    }
    const reorderStockQuantity = packageCountToStock(candidate, reorderPackageCount);

    onAdd({
      productId: candidate.productId,
      barcode: code,
      name: candidate.name,
      brand: candidate.brand,
      unit: stockQuantity.unit,
      category: candidate.category ?? "Altro",
      calories: candidate.calories,
      protein: candidate.protein,
      carbs: candidate.carbs,
      fat: candidate.fat,
      fiber: candidate.fiber,
      reorderPoint: parsedReorderPoint,
      reorderQuantity: reorderStockQuantity.quantity,
      location,
      batches: [{ quantity: stockQuantity.quantity, expiryDate: expiry || undefined }],
    });
  }

  const phaseLabel: Record<ScannerPhase, string> = {
    IDLE: "",
    INITIALIZING: "Avvio",
    FOCUS_SETTLING: "Autofocus",
    QUALITY_CHECK: "Qualità",
    DECODING: "Lettura",
    VERIFYING: "Verifica",
    RECOVERING: "Recovery",
  };

  return (
    <div className="p-4 space-y-5 sm:p-6">
      <div className="flex items-center gap-3"><button onClick={() => { stopCamera(); onBack(); }} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button><h3 className="text-lg font-light flex-1" style={{ color: "#1a1510" }}>Foto / barcode</h3></div>

      {state === "IDLE" && <div className="space-y-4">
        <button onClick={startCamera} className="w-full py-4 rounded-2xl flex flex-col items-center gap-2" style={{ backgroundColor: "#fff", border: "2px dashed #d8cfc0" }}><span className="text-4xl">📷</span><p className="font-medium text-sm">Scatta con la fotocamera</p><p className="text-xs" style={{ color: "#6b5e4e" }}>Inquadra il barcode del prodotto</p></button>
        <label className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}><span>🖼️</span><span className="text-sm font-medium" style={{ color: "#6b5e4e" }}>Carica una foto del barcode</span><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { const bitmap = await createImageBitmap(file); try { await scanSource(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); } } catch { setError("Non è stato possibile aprire l'immagine."); setState("MANUAL_REQUIRED"); } }} /></label>
        <div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Inserisci barcode manualmente" className="flex-1 px-3 py-2.5 rounded-xl text-sm" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }} /><button onClick={() => code.trim() && resolve(code)} className="px-4 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Cerca</button></div>
        {error && <Message>{error}</Message>}
      </div>}

      {state === "SCANNING" && (
        <div className="space-y-3">
          <div
            className="relative rounded-2xl overflow-hidden bg-black"
            style={{ aspectRatio: cameraAspectRatio, maxHeight: "62vh" }}
          >
            {localization && videoRef.current && (
        <div
          className="pointer-events-none absolute border-2 border-emerald-400 rounded-lg"
          style={{
            left: (localization.x / Math.max(1, videoRef.current.videoWidth)) * 100 + "%",
            top: (localization.y / Math.max(1, videoRef.current.videoHeight)) * 100 + "%",
            width: (localization.width / Math.max(1, videoRef.current.videoWidth)) * 100 + "%",
            height: (localization.height / Math.max(1, videoRef.current.videoHeight)) * 100 + "%",
          }}
          aria-label={"Barcode localizzato, confidenza " + Math.round(localization.confidence * 100) + "%"}
        />
      )}<video
              ref={videoRef}
              className="w-full h-full object-contain bg-black"
              playsInline
              muted
              autoPlay
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={expandedViewfinder ? "w-[94%] h-[56%] border-2 rounded-xl" : "w-[82%] h-[38%] border-2 rounded-xl"}
                style={{
                  borderColor: "#c4623a",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,.45)",
                }}
              />
            </div>
            {cameraDiagnostics?.torchSupported && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                className="absolute top-3 right-3 rounded-full px-3 py-2 text-xs font-semibold"
                style={{
                  backgroundColor: cameraDiagnostics.torchEnabled ? "#fff" : "rgba(26,21,16,.72)",
                  color: cameraDiagnostics.torchEnabled ? "#1a1510" : "#fff",
                }}
              >
                🔦 {cameraDiagnostics.torchEnabled ? "Luce ON" : "Luce"}
              </button>
            )}
          </div>

          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div>
                <p className="text-xs font-semibold" style={{ color: "#1a1510" }}>Confronto post-preprocessing</p>
                <p className="text-[10px]" style={{ color: "#6b5e4e" }}>
                  FULL FRAME → localizzazione → rettifica → preprocessing → decoder.
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "#6b5e4e" }}>
                <input type="checkbox" checked={showPreprocessPreview} onChange={(e) => setShowPreprocessPreview(e.target.checked)} />
                Live
              </label>
            </div>
            {showPreprocessPreview && (
              <>
                <div className="px-3 pb-2 flex items-center justify-between gap-2">
                  <span className="text-[9px]" style={{ color: "#8a7c6b" }}>
                    {previewUpdatedAt ? "Aggiornamento live ogni ~300 ms" : "In attesa del primo frame…"}
                  </span>
                  <span className="text-[9px]" style={{ color: "#8a7c6b" }}>
                    {localization ? `ROI ${Math.round(localization.confidence * 100)}% · no rotazione` : "Ricerca ROI"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                  {previewVariants.map((variant) => {
                    const labels: Record<PreprocessVariant, string> = {
                      raw: "1 · RAW / grayscale",
                      equalized: "2 · Equalized + gamma",
                      clahe: "3 · CLAHE",
                      sauvola: "4 · Sauvola",
                      bradley: "5 · Bradley",
                      upscaled: "6 · Upscale + sharpen",
                    };
                    return (
                      <div key={variant} className="rounded-lg overflow-hidden" style={{ backgroundColor: "#0b0b0b", border: "1px solid #d8cfc0" }}>
                        <div className="px-2 py-1.5 text-[10px] font-semibold" style={{ backgroundColor: "#f5f0e8", color: "#1a1510" }}>
                          {labels[variant]}
                        </div>
                        <canvas
                          ref={(node) => {
                            preprocessPreviewCanvasRefs.current[variant] = node;
                          }}
                          className="block w-full h-auto"
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl px-3 py-2 text-[11px]" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {cameraDiagnostics && <span>Camera {cameraDiagnostics.width}×{cameraDiagnostics.height}</span>}
              {cameraDiagnostics?.frameRate != null && <span>{Math.round(cameraDiagnostics.frameRate)} fps</span>}
              {cameraDiagnostics && <span>{cameraDiagnostics.continuousFocus ? "AF continuo" : "AF non disponibile"}</span>}
              {cameraDiagnostics?.zoom != null && <span>Zoom {cameraDiagnostics.zoom.toFixed(1)}×</span>}
              {phaseLabel[scannerPhase] && <span>Fase: {phaseLabel[scannerPhase]}</span>}
              {frameQuality && <span>Qualità {frameQuality.quality === "good" ? "buona" : frameQuality.quality === "usable" ? "discreta" : "bassa"} ({Math.round(frameQuality.score * 100)}%)</span>}
              {localization && <span>ROI · {Math.round(localization.confidence * 100)}%</span>}
            </div>
          </div>

          <div className="rounded-xl px-3 py-2 text-sm" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0", color: "#4b4035" }}>
            {scannerMessage}
          </div>

          <button
            onClick={() => { stopCamera(); setState("IDLE"); }}
            className="w-full py-2.5 rounded-xl"
            style={{ backgroundColor: "#ede6d6" }}
          >
            Annulla scansione
          </button>
        </div>
      )}

      {state === "LOOKING" && <div className="py-10 text-center space-y-4"><div className="w-10 h-10 mx-auto rounded-full animate-spin" style={{ border: "3px solid #ede6d6", borderTopColor: "#c4623a" }} /><p className="text-sm" style={{ color: "#6b5e4e" }}>Ricerca prodotto per barcode…</p>{code && <p className="font-mono text-sm">{code}</p>}</div>}

      {state === "CANDIDATE" && candidate && <CandidateView candidate={candidate} code={code} onCorrect={() => setState("MANUAL_REQUIRED")} onConfirm={confirmCandidate} />}

      {(state === "CONFIRMED") && candidate && <ConfirmStock candidate={candidate} qty={qty} setQty={setQty} expiry={expiry} setExpiry={setExpiry} reorderPoint={reorderPoint} setReorderPoint={setReorderPoint} reorderQuantity={reorderQuantity} setReorderQuantity={setReorderQuantity} location={location} setLocation={setLocation} onBack={() => setState("CANDIDATE")} onSave={save} />}

      {(state === "MANUAL_REQUIRED" || state === "NOT_FOUND" || state === "DEGRADED") && <div className="space-y-4"><Message>{error ?? (state === "NOT_FOUND" ? `Nessun prodotto trovato per ${code}.` : "Verifica non riuscita.")}</Message>{state === "NOT_FOUND" && <ManualProduct onAdd={onAdd} code={code} onBack={() => setState("IDLE")} />}{state !== "NOT_FOUND" && <><button onClick={() => resolve(code)} disabled={!code} className="w-full py-2.5 rounded-xl" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Riprova ricerca</button><button onClick={() => setState("NOT_FOUND")} className="w-full py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Inserisci manualmente</button></>}</div>}
    </div>
  );
}

function CandidateView({ candidate, code, message, onCorrect, onConfirm }: { candidate: Candidate; code: string; message?: string; onCorrect: () => void; onConfirm: () => void }) {
  const raw = candidate.openFoodFacts ?? {};
  const nutriments = isRecord(raw.nutriments) ? raw.nutriments : {};
  const frontImage = candidate.images?.front ?? candidate.photoUrl;
  const imageEntries = galleryImages(candidate.images);

  return (
    <div className="space-y-4">
      <Message>{message ?? "Barcode rilevato: " + code}</Message>

      <div className="rounded-2xl p-5 space-y-5" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
        {frontImage && (
          <img src={frontImage} alt={candidate.name} className="w-full max-h-72 rounded-xl object-contain bg-white" />
        )}

        <div>
          <p className="text-xl font-semibold">{candidate.name}</p>
          {candidate.brand && <p className="text-sm mt-1" style={{ color: "#6b5e4e" }}>{candidate.brand}</p>}
          <p className="text-xs mt-2" style={{ color: "#6b5e4e" }}>
            Fonte: {candidate.provenanceQuality === "VERIFIED" ? "catalogo locale" : "Open Food Facts"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <InfoCell label="Quantità confezione" value={candidate.quantityLabel ?? (candidate.quantityValue != null && candidate.quantityUnit ? String(candidate.quantityValue) + " " + candidate.quantityUnit : "—")} />
          <InfoCell label="Unità" value={candidate.quantityUnit ?? candidate.unit ?? "—"} />
          <InfoCell label="Categoria" value={candidate.category ?? "—"} />
          <InfoCell label="Serving" value={candidate.servingQuantity != null ? `${candidate.servingQuantity}${candidate.servingUnit ? ` ${candidate.servingUnit}` : ""}` : candidate.servingSize ?? "—"} />
        </div>

        {Object.keys(nutriments).length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Valori nutrizionali Open Food Facts</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(nutriments).slice(0, 18).map(([key, value]) => (
                <InfoCell key={key} label={humanizeOffKey(key)} value={formatOffValue(value)} />
              ))}
            </div>
          </div>
        )}

        <OpenFoodFactsSection raw={raw} images={imageEntries} />
      </div>

      <p className="text-xs" style={{ color: "#6b5e4e" }}>
        Questi dati provengono da Open Food Facts e vengono conservati integralmente nel Catalogo.
        Nessun prodotto viene inserito nella scorta fino alla conferma.
      </p>

      <div className="flex gap-3">
        <button onClick={onCorrect} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Correggi</button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Conferma prodotto</button>
      </div>
    </div>
  );
}

function OpenFoodFactsSection({ raw, images }: { raw: Record<string, unknown>; images: GalleryImage[] }) {
  const stringValue = (key: string) => typeof raw[key] === "string" ? raw[key] as string : undefined;
  const arrayValue = (key: string) => Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((v): v is string => typeof v === "string") : [];

  const ingredients = stringValue("ingredients_text_it") ?? stringValue("ingredients_text");
  const allergens = arrayValue("allergens_tags");
  const traces = arrayValue("traces_tags");
  const labels = arrayValue("labels_tags");
  const categories = arrayValue("categories_tags");
  const countries = arrayValue("countries_tags");
  const stores = arrayValue("stores_tags");
  const packaging = stringValue("packaging_text") ?? stringValue("packaging");
  const nutriscore = stringValue("nutriscore_grade") ?? stringValue("nutrition_grades");
  const nova = raw.nova_group != null ? String(raw.nova_group) : undefined;
  const ecoscore = stringValue("ecoscore_grade");
  const origins = stringValue("origins");

  return (
    <div className="space-y-4">
      {images.length > 1 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Immagini disponibili</p>
          <div className="grid grid-cols-3 gap-2">
            {images.map(({ key, full, preview }) => (
              <a key={key} href={full} target="_blank" rel="noreferrer" className="block">
                <img src={preview} alt={key} loading="lazy" className="w-full h-24 rounded-lg object-cover bg-white border" />
                <span className="block text-[10px] mt-1 truncate" style={{ color: "#6b5e4e" }}>{humanizeOffKey(key)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {(ingredients || allergens.length || traces.length || labels.length || categories.length || countries.length || stores.length || packaging || nutriscore || nova || ecoscore || origins) && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Informazioni prodotto</p>
          <div className="space-y-2">
            {ingredients && <InfoCell label="Ingredienti" value={ingredients} />}
            {packaging && <InfoCell label="Packaging" value={packaging} />}
            {origins && <InfoCell label="Origine" value={origins} />}
            {allergens.length > 0 && <InfoCell label="Allergeni" value={allergens.map(cleanTag).join(", ")} />}
            {traces.length > 0 && <InfoCell label="Tracce" value={traces.map(cleanTag).join(", ")} />}
            {labels.length > 0 && <InfoCell label="Etichette" value={labels.map(cleanTag).join(", ")} />}
            {categories.length > 0 && <InfoCell label="Categorie" value={categories.map(cleanTag).join(", ")} />}
            {countries.length > 0 && <InfoCell label="Paesi" value={countries.map(cleanTag).join(", ")} />}
            {stores.length > 0 && <InfoCell label="Negozi" value={stores.map(cleanTag).join(", ")} />}
            {nutriscore && <InfoCell label="Nutri-Score" value={nutriscore.toUpperCase()} />}
            {nova && <InfoCell label="NOVA" value={nova} />}
            {ecoscore && <InfoCell label="Eco-Score" value={ecoscore.toUpperCase()} />}
          </div>
        </div>
      )}

      <details className="rounded-xl overflow-hidden" style={{ backgroundColor: "#f5f0e8", border: "1px solid #d8cfc0" }}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Tutti i dati originali Open Food Facts</summary>
        <pre className="px-4 pb-4 text-[10px] leading-4 overflow-x-auto whitespace-pre-wrap break-words" style={{ color: "#4b4035" }}>
{JSON.stringify(raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: "#f5f0e8" }}>
      <p className="text-[10px]" style={{ color: "#6b5e4e" }}>{label}</p>
      <p className="text-xs font-medium mt-0.5 break-words" style={{ color: "#1a1510" }}>{value}</p>
    </div>
  );
}

type GalleryImage = { key: string; full: string; preview: string };

const GALLERY_KINDS = ["front", "ingredients", "nutrition", "packaging"] as const;

/**
 * One entry per image kind instead of one per rendition: the catalog stores front/frontSmall/
 * frontThumb (and the same for the other kinds) but they are the same picture. The Small
 * rendition is used as the on-screen thumbnail, the full one as the link target.
 */
function galleryImages(images: Candidate["images"]): GalleryImage[] {
  if (!images) return [];
  const pick = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
  const result: GalleryImage[] = [];
  for (const kind of GALLERY_KINDS) {
    const full = pick(images[kind]);
    const small = pick(images[`${kind}Small` as keyof typeof images]);
    const thumb = pick(images[`${kind}Thumb` as keyof typeof images]);
    const preview = small ?? thumb ?? full;
    if (!preview) continue;
    result.push({ key: kind, full: full ?? preview, preview });
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeOffKey(key: string): string {
  return key
    .replace(/_100g$/, " / 100 g")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatOffValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return JSON.stringify(value);
}

function cleanTag(value: string): string {
  return value.replace(/^\w+:/, "").replaceAll("-", " ");
}

function OptionalReorderFields({ reorderPoint, onReorderPointChange, reorderQuantity, onReorderQuantityChange }: { reorderPoint: string; onReorderPointChange: (value: string) => void; reorderQuantity: string; onReorderQuantityChange: (value: string) => void }) {
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ backgroundColor: "#fffaf4", border: "1px solid #e2d6c6" }}>
      <Field label="Scorta minima / soglia riordino (unità fisiche, opzionale)" type="number" value={reorderPoint} onChange={onReorderPointChange} />
      <Field label="Quantità da riacquistare (confezioni)" type="number" value={reorderQuantity} onChange={onReorderQuantityChange} />
      <p className="text-[11px]" style={{ color: "#6b5e4e" }}>Inserisci il numero di confezioni da acquistare, ad esempio 1, 2 o 3. Se la confezione è da 90 g, 2 confezioni verranno salvate come 180 g.</p>
    </div>
  );
}

function ConfirmStock({ candidate, qty, setQty, expiry, setExpiry, reorderPoint, setReorderPoint, reorderQuantity, setReorderQuantity, location, setLocation, onBack, onSave }: { candidate: Candidate; qty: string; setQty: (v: string) => void; expiry: string; setExpiry: (v: string) => void; reorderPoint: string; setReorderPoint: (v: string) => void; reorderQuantity: string; setReorderQuantity: (v: string) => void; location: StorageLocation; setLocation: (v: StorageLocation) => void; onBack: () => void; onSave: () => void }) {
  const packageLabel = candidate.quantityLabel
    ?? (candidate.quantityValue != null && candidate.quantityUnit
      ? String(candidate.quantityValue) + " " + candidate.quantityUnit
      : null);

  return <div className="space-y-4">
    <div className="rounded-2xl p-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
      <p className="font-semibold">{candidate.name}</p>
      {candidate.brand && <p className="text-xs" style={{ color: "#6b5e4e" }}>{candidate.brand}</p>}
    </div>
    <Field label="Quantità (confezioni)" type="number" value={qty} onChange={setQty} />
    {packageLabel && (
      <p className="text-[11px] -mt-2" style={{ color: "#6b5e4e" }}>
        1 confezione = {packageLabel}. Inserisci solo il numero di confezioni; la quantità fisica viene calcolata automaticamente.
      </p>
    )}
    <Field label="Scadenza" type="date" value={expiry} onChange={setExpiry} />
    <OptionalReorderFields
      reorderPoint={reorderPoint}
      onReorderPointChange={setReorderPoint}
      reorderQuantity={reorderQuantity}
      onReorderQuantityChange={setReorderQuantity}
    />
    <div><label className="text-xs font-medium block mb-1">Luogo</label><select value={location} onChange={(e) => setLocation(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}>{LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}</select></div>
    <p className="text-xs" style={{ color: "#6b5e4e" }}>Lascia la scadenza vuota per usare automaticamente la stima Shelf-Life. Il prodotto verrà scritto nella scorta solo premendo l'ultimo pulsante.</p>
    <div className="flex gap-3"><button onClick={onBack} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Indietro</button><button onClick={onSave} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Inserisci nella scorta</button></div>
  </div>;
}
function ManualProduct({ onAdd, code, onBack }: { onAdd: Props["onAdd"]; code: string; onBack: () => void }) {
  const [name, setName] = useState(""); const [qty, setQty] = useState("1"); const [expiry, setExpiry] = useState(""); const [reorderPoint, setReorderPoint] = useState(""); const [reorderQuantity, setReorderQuantity] = useState("1"); const [location, setLocation] = useState<StorageLocation>("dispensa");
  return <div className="space-y-3"><Field label="Nome prodotto" value={name} onChange={setName} /><Field label="Quantità" type="number" value={qty} onChange={setQty} /><Field label="Scadenza" type="date" value={expiry} onChange={setExpiry} /><OptionalReorderFields reorderPoint={reorderPoint} onReorderPointChange={setReorderPoint} reorderQuantity={reorderQuantity} onReorderQuantityChange={setReorderQuantity} /><div><label className="text-xs font-medium block mb-1">Luogo</label><select value={location} onChange={(e) => setLocation(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}>{LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}</select></div><div className="flex gap-3"><button onClick={onBack} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Indietro</button><button disabled={!name.trim()} onClick={() => { const parsed = reorderPoint.trim() === "" ? undefined : Number(reorderPoint); const parsedQuantity = parsed === undefined ? undefined : (reorderQuantity.trim() === "" ? 1 : Number(reorderQuantity)); if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) return; if (parsedQuantity !== undefined && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)) return; onAdd({ name: name.trim(), barcode: code || undefined, unit: "piece", category: "Altro", reorderPoint: parsed, reorderQuantity: parsedQuantity, location, batches: [{ quantity: Number(qty), expiryDate: expiry || undefined }] }); }} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: name.trim() ? "#c4623a" : "#d8cfc0", color: "#fff" }}>Inserisci nella scorta</button></div></div>;
}

function ManualForm({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.searchCatalogProducts>>["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [candidateCode, setCandidateCode] = useState("");
  const [state, setState] = useState<"SEARCH" | "CANDIDATE" | "CONFIRMED" | "FALLBACK">("SEARCH");
  const [qty, setQty] = useState("1");
  const [expiry, setExpiry] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");
  const [reorderQuantity, setReorderQuantity] = useState("1");
  const [location, setLocation] = useState<StorageLocation>("dispensa");

  useEffect(() => {
    if (state !== "SEARCH") return;
    const normalized = query.trim();
    if (normalized.length < 3) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.searchCatalogProducts(normalized, 8, controller.signal);
        if (!controller.signal.aborted) {
          setItems(result.items);
          if (result.items.length === 0) setError("Nessun prodotto trovato su Open Food Facts.");
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setItems([]);
        setError(isBackendUnreachable(err) ? "Impossibile contattare il server." : "La ricerca prodotto non è disponibile in questo momento.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, state]);

  async function selectProduct(item: (typeof items)[number]) {
    setLoading(true);
    setError(null);
    try {
      // Selection intentionally reuses the existing barcode path: the complete OFF record is
      // resolved and persisted in Catalog only after the user chooses a search result.
      const result = await api.resolveProductBarcode("BARCODE", item.code);
      if (result.status !== "MATCHED" || !result.product) {
        setError("Il prodotto selezionato non è più disponibile su Open Food Facts.");
        return;
      }
      const resolvedCandidate = candidateFromProduct(result.product);
      setCandidate(resolvedCandidate);
      setQty(defaultPackageCount(resolvedCandidate));
      setReorderQuantity(defaultPackageCount(resolvedCandidate));
      setCandidateCode(item.code);
      setState("CANDIDATE");
    } catch (err) {
      setError(isBackendUnreachable(err) ? "Impossibile contattare il server." : "Non è stato possibile caricare i dati completi del prodotto.");
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!candidate) return;

    const packageCount = Number(qty);
    if (!Number.isInteger(packageCount) || packageCount <= 0) {
      setError("La quantità deve essere un numero intero di confezioni maggiore di zero.");
      return;
    }

    const stockQuantity = packageCountToStock(candidate, packageCount);
    const parsedReorderPoint = reorderPoint.trim() === "" ? undefined : Number(reorderPoint);
    if (parsedReorderPoint !== undefined && (!Number.isFinite(parsedReorderPoint) || parsedReorderPoint < 0)) {
      setError("La soglia di riordino deve essere un numero maggiore o uguale a zero.");
      return;
    }

    const reorderPackageCount = reorderQuantity.trim() === "" ? 1 : Number(reorderQuantity);
    if (!Number.isInteger(reorderPackageCount) || reorderPackageCount <= 0) {
      setError("La quantità da riacquistare deve essere un numero intero di confezioni maggiore di zero.");
      return;
    }
    const reorderStockQuantity = packageCountToStock(candidate, reorderPackageCount);

    onAdd({
      productId: candidate.productId,
      barcode: candidateCode,
      name: candidate.name,
      brand: candidate.brand,
      unit: stockQuantity.unit,
      category: candidate.category ?? "Altro",
      calories: candidate.calories,
      protein: candidate.protein,
      carbs: candidate.carbs,
      fat: candidate.fat,
      fiber: candidate.fiber,
      reorderPoint: parsedReorderPoint,
      reorderQuantity: reorderStockQuantity.quantity,
      location,
      batches: [{ quantity: stockQuantity.quantity, expiryDate: expiry || undefined }],
    });
  }

  if (state === "CANDIDATE" && candidate) {
    return (
      <CandidateView
        candidate={candidate}
        code={candidateCode}
        message="Prodotto selezionato dalla ricerca Open Food Facts"
        onCorrect={() => setState("SEARCH")}
        onConfirm={() => setState("CONFIRMED")}
      />
    );
  }

  if (state === "CONFIRMED" && candidate) {
    return (
      <ConfirmStock
        candidate={candidate}
        qty={qty}
        setQty={setQty}
        expiry={expiry}
        setExpiry={setExpiry}
        reorderPoint={reorderPoint}
        setReorderPoint={setReorderPoint}
        reorderQuantity={reorderQuantity}
        setReorderQuantity={setReorderQuantity}
        location={location}
        setLocation={setLocation}
        onBack={() => setState("CANDIDATE")}
        onSave={save}
      />
    );
  }

  if (state === "FALLBACK") {
    return (
      <div className="space-y-3">
        <Message>Open Food Facts non ha trovato una corrispondenza. Puoi comunque inserirlo manualmente.</Message>
        <ManualProduct onAdd={onAdd} code="" onBack={() => setState("SEARCH")} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 sm:p-6">
      <button onClick={onBack} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button>
      <div>
        <p className="text-lg font-semibold" style={{ color: "#1a1510" }}>Trova il prodotto</p>
        <p className="text-xs mt-1" style={{ color: "#6b5e4e" }}>Scrivi il nome, poi scegli la confezione corretta.</p>
      </div>

      <Field label="Nome prodotto" value={query} onChange={setQuery} />
      {query.trim().length > 0 && query.trim().length < 3 && (
        <p className="text-xs" style={{ color: "#6b5e4e" }}>Inserisci almeno 3 caratteri.</p>
      )}

      {loading && (
        <div className="py-6 text-center">
          <div className="w-8 h-8 mx-auto rounded-full animate-spin" style={{ border: "3px solid #ede6d6", borderTopColor: "#c4623a" }} />
          <p className="text-xs mt-3" style={{ color: "#6b5e4e" }}>Cerco tra i prodotti Open Food Facts…</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: "#6b5e4e" }}>Risultati più pertinenti</p>
          {items.map((item) => (
            <button
              key={item.code}
              onClick={() => void selectProduct(item)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl text-left"
              style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}
            >
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" loading="lazy" className="w-14 h-14 rounded-xl object-contain bg-white border" />
              ) : (
                <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#f5f0e8" }}>🍽️</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: "#1a1510" }}>{item.name}</p>
                {item.brand && <p className="text-xs mt-0.5 truncate" style={{ color: "#6b5e4e" }}>{item.brand}</p>}
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px]" style={{ color: "#6b5e4e" }}>
                  {item.packageLabel && <span>{item.packageLabel}</span>}
                  {item.category && <span>{item.category}</span>}
                  {item.completeness != null && <span>Dati {Math.round(item.completeness * 100)}%</span>}
                </div>
              </div>
              <span style={{ color: "#d8cfc0" }}>›</span>
            </button>
          ))}
        </div>
      )}

      {!loading && error && query.trim().length >= 3 && items.length === 0 && (
        <Message>{error}</Message>
      )}
      {error && <Message>{error}</Message>}

      {query.trim().length >= 3 && (
        <button onClick={() => setState("FALLBACK")} className="w-full py-2.5 rounded-xl text-sm" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
          Inserisci comunque manualmente
        </button>
      )}
    </div>
  );
}

function ImportList({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) { const [text,setText]=useState(""); const [done,setDone]=useState(false); const items=text.split("\n").map(x=>x.trim()).filter(Boolean); return <div className="p-4 space-y-4 sm:p-6"><button onClick={onBack} className="text-sm">← Indietro</button><textarea value={text} onChange={e=>setText(e.target.value)} rows={8} className="w-full px-3 py-2 rounded-xl" style={{backgroundColor:"#ede6d6",border:"1px solid #d8cfc0"}} placeholder="Latte\nUova\nPomodori"/><button disabled={!items.length} onClick={()=>{items.forEach(name=>onAdd({name,unit:"piece",location:"dispensa",category:"Altro",batches:[{quantity:1}]}));setDone(true)}} className="w-full py-2.5 rounded-xl" style={{backgroundColor:items.length?"#c4623a":"#d8cfc0",color:"#fff"}}>{done?"Prodotti inseriti ✓":`Inserisci ${items.length} prodotti`}</button></div>; }

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <div><label className="text-xs font-medium block mb-1" style={{color:"#6b5e4e"}}>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} className="w-full px-3 py-2 rounded-xl" style={{backgroundColor:"#ede6d6",border:"1px solid #d8cfc0",color:"#1a1510"}}/></div>; }
function Message({ children }: { children: React.ReactNode }) { return <div className="rounded-xl px-4 py-3 text-sm" style={{backgroundColor:"#faecd4",color:"#92400e"}}>{children}</div>; }
