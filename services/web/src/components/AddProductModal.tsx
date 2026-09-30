import { useState, useRef, useEffect, useCallback } from "react";
import type { StockItem, StorageLocation, ActionState } from "../types";
import * as api from "../api/endpoints";
import {
  isBarcodeDetectorAvailable,
  detectBestBarcode,
  computeViewfinderCrop,
  type BarcodeHit,
} from "../lib/barcodePreprocess";
import { isBackendUnreachable } from "../api/client.js";

type AddMode = "menu" | "manuale" | "barcode" | "foto" | "lista";
type BarcodeState =
  | "IDLE"
  | "SCANNING"
  | "LOOKING"
  | "CANDIDATE"
  | "MANUAL_REQUIRED"
  | "NOT_FOUND"
  | "DEGRADED"
  | "CONFIRMED";

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

export default function AddProductModal({ onClose, onAdd }: Props) {
  const [mode, setMode] = useState<AddMode>("menu");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(26,21,16,0.48)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ backgroundColor: "#f5f0e8", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "menu" && <ModeMenu onSelect={setMode} onClose={onClose} />}
        {mode === "manuale" && <ManualForm onAdd={onAdd} onBack={() => setMode("menu")} />}
        {mode === "barcode" && <BarcodeScanner onAdd={onAdd} onBack={() => setMode("menu")} />}
        {mode === "foto" && <PhotoCapture onAdd={onAdd} onBack={() => setMode("menu")} />}
        {mode === "lista" && <ImportList onAdd={onAdd} onBack={() => setMode("menu")} />}
      </div>
    </div>
  );
}

// ── Mode selection ─────────────────────────────────────────────────────────────
function ModeMenu({ onSelect, onClose }: { onSelect: (m: AddMode) => void; onClose: () => void }) {
  const modes = [
    { key: "barcode" as AddMode, icon: "📷", label: "Scansiona barcode", desc: "Usa la fotocamera per leggere il codice a barre" },
    { key: "foto" as AddMode, icon: "🖼️", label: "Foto prodotto", desc: "Scatta o carica una foto dello scontrino o del prodotto" },
    { key: "manuale" as AddMode, icon: "✏️", label: "Inserimento manuale", desc: "Compila i campi a mano" },
    { key: "lista" as AddMode, icon: "📋", label: "Importa lista", desc: "Incolla una lista di prodotti" },
  ];
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>
          Aggiungi prodotto
        </h3>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full transition-opacity hover:opacity-60" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>×</button>
      </div>
      <div className="space-y-2">
        {modes.map((m) => (
          <button
            key={m.key}
            onClick={() => onSelect(m.key)}
            className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:opacity-90"
            style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}
          >
            <span className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl shrink-0" style={{ backgroundColor: "#f0ddd5" }}>
              {m.icon}
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#1a1510" }}>{m.label}</p>
              <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>{m.desc}</p>
            </div>
            <span className="ml-auto text-sm" style={{ color: "#d8cfc0" }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Barcode scanner ────────────────────────────────────────────────────────────
function BarcodeScanner({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<BarcodeState>("IDLE");
  const [candidate, setCandidate] = useState<{
    name: string;
    brand?: string;
    unit: string;
    category?: string;
    photoUrl?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    provenanceQuality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
  } | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [form, setForm] = useState<Partial<StockItem>>({});
  const [qty, setQty] = useState("1");
  const [loc, setLoc] = useState<StorageLocation>("dispensa");
  const [expiry, setExpiry] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanTimeoutRef = useRef<number | null>(null);
  const lastSeenRef = useRef<{ value: string; count: number }>({ value: "", count: 0 });
  const stoppedRef = useRef(false);

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (scanTimeoutRef.current !== null) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    lastSeenRef.current = { value: "", count: 0 };
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // ── Fotocamera ──────────────────────────────────────────────────────────────
  //
  // Constraints: risoluzione alta (più pixel sul barcode), autofocus continuo,
  // leggero zoom digitale per far riempire il codice. I parametri focus/zoom NON
  // sono standard in `getUserMedia`, quindi li applichiamo in un secondo momento
  // via `applyConstraints` controllando `getCapabilities()` — su iOS/desktop
  // semplicemente non sono disponibili e li saltiamo.
  async function startCamera() {
    if (!isBarcodeDetectorAvailable()) {
      setCameraError(
        "Questo browser non espone la decodifica barcode nativa. Puoi comunque caricare una foto o inserire il codice manualmente.",
      );
      setState("IDLE");
      return;
    }
    setState("SCANNING");
    setCameraError(null);
    stoppedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
      if (stoppedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      // Applica focus/zoom/exposure avanzati se il device li supporta.
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
            focusMode?: string[];
            zoom?: { min: number; max: number; step?: number };
          };
          const advanced: MediaTrackConstraintSet[] = [];
          if (caps.focusMode?.includes("continuous")) {
            advanced.push({ focusMode: "continuous" } as unknown as MediaTrackConstraintSet);
          }
          if (caps.zoom && caps.zoom.max > caps.zoom.min) {
            const bump = caps.zoom.min + (caps.zoom.max - caps.zoom.min) * 0.2;
            advanced.push({ zoom: bump } as unknown as MediaTrackConstraintSet);
          }
          if (advanced.length > 0) {
            await track.applyConstraints({ advanced } as MediaTrackConstraints);
          }
        } catch {
          /* capabilities non disponibili: nessun problema */
        }
      }

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        setState("IDLE");
        return;
      }
      video.srcObject = stream;
      await video.play();

      scheduleScanFrame();
    } catch {
      stopCamera();
      setCameraError("Impossibile accedere alla fotocamera. Controlla i permessi del browser.");
      setState("IDLE");
    }
  }

  // ── Loop di scansione ───────────────────────────────────────────────────────
  //
  // setTimeout ricorsivo (non setInterval) per evitare che le chiamate async si
  // accavallino: la prossima iterazione parte solo dopo che la precedente è
  // terminata. La pipeline multi-variante richiede ~100-300 ms per frame.
  function scheduleScanFrame() {
    if (stoppedRef.current) return;
    scanTimeoutRef.current = window.setTimeout(scanFrame, 500);
  }

  async function scanFrame() {
    if (stoppedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      scheduleScanFrame();
      return;
    }

    try {
      const crop = computeViewfinderCrop(video.videoWidth, video.videoHeight);
      const hit: BarcodeHit | null = await detectBestBarcode(
        video,
        video.videoWidth,
        video.videoHeight,
        { maxDimension: 900, crop },
      );

      if (hit) {
        // Richiediamo la stessa lettura su due frame consecutivi prima di accettarla:
        // un singolo frame può produrre una lettura valida-per-checksum ma sbagliata
        // (raro, ma possibile con riflessi che cambiano). Due letture identiche di
        // fila sono un segnale molto più affidabile.
        if (lastSeenRef.current.value === hit.rawValue) {
          lastSeenRef.current.count += 1;
        } else {
          lastSeenRef.current = { value: hit.rawValue, count: 1 };
        }
        // Se il valore è già validato GS1, basta 1 frame; altrimenti ne servono 2.
        const threshold = hit.validated ? 1 : 2;
        if (lastSeenRef.current.count >= threshold) {
          const confirmed = hit.rawValue;
          stopCamera();
          void processBarcode(confirmed);
          return;
        }
      } else {
        lastSeenRef.current = { value: "", count: 0 };
      }
    } catch (err) {
      // Non inghiottire i ReferenceError: se c'è un bug interno, vogliamo saperlo.
      if (err instanceof ReferenceError) {
        console.error("[barcode] bug interno nello scanner:", err);
        stopCamera();
        setCameraError("Errore interno dello scanner. Riprova.");
        setState("IDLE");
        return;
      }
    }

    scheduleScanFrame();
  }

  // ── Risoluzione codice ──────────────────────────────────────────────────────
  //
  // Catena: catalogo locale → worker esterno (Open Food Facts). Tre esiti:
  //  - MATCHED: trovato → mostra candidato.
  //  - UNKNOWN: non esiste → inserimento manuale.
  //  - DEGRADED: worker/OFF non ha risposto → retry.
 async function processBarcode(code: string) {
  setManualCode(code);
  setCameraError(null);   // pulisce eventuali messaggi precedenti
  setState("LOOKING");
  try {
    const result = await api.resolveProductBarcode("BARCODE", code);
    if (result.status === "MATCHED" && result.product) {
      setCandidate({
        name: result.product.canonicalName,
        ...(result.product.brand ? { brand: result.product.brand } : {}),
        unit: result.product.defaultUnit,
        ...(result.product.category ? { category: result.product.category } : {}),
        ...(result.product.photoUrl ? { photoUrl: result.product.photoUrl } : {}),
        ...(result.product.calories !== undefined ? { calories: result.product.calories } : {}),
        ...(result.product.protein !== undefined ? { protein: result.product.protein } : {}),
        ...(result.product.carbs !== undefined ? { carbs: result.product.carbs } : {}),
        ...(result.product.fat !== undefined ? { fat: result.product.fat } : {}),
        ...(result.product.fiber !== undefined ? { fiber: result.product.fiber } : {}),
        provenanceQuality: result.product.provenanceQuality,
      });
      setState("CANDIDATE");
      return;
    }

    if (result.status === "DEGRADED") {
      // Il worker ha risposto ma il provider esterno (Open Food Facts) non ha risposto
      // in tempo o è rate-limited. È un problema temporaneo, il retry ha senso.
      setCameraError(
        "Open Food Facts non ha risposto in tempo. Riprova tra poco oppure inserisci i dati manualmente.",
      );
      setState("DEGRADED");
      return;
    }

    // status === "UNKNOWN" | qualsiasi altro valore: il worker ha risposto e il prodotto
    // non esiste né in catalogo locale né su OFF.
    setState("NOT_FOUND");
  } catch (err) {
    // Distinguiamo le due famiglie di errore, altrimenti l'utente vede un messaggio
    // fuorviante ("Open Food Facts lento") quando in realtà il backend non è
    // raggiungibile (es. `localhost` chiamato dal telefono, mixed content, CORS).
    if (isBackendUnreachable(err)) {
      setCameraError(
        "Impossibile contattare il server. Verifica di essere connesso e che l'app punti all'indirizzo giusto, poi riprova.",
      );
    } else {
      console.error("[barcode] resolve fallita:", err);
      setCameraError("Errore imprevisto durante la verifica del codice. Riprova o inserisci manualmente.");
    }
    setState("DEGRADED");
  }
}

  // ── Upload foto con barcode ─────────────────────────────────────────────────
  //
  // La pipeline di preprocessing è la stessa del video, ma può essere più aggressiva
  // perché abbiamo una sola immagine e tutto il tempo che serve: maxDimension più
  // alto (1600) e nessun crop (l'utente ha già inquadrato il codice).
  async function handleFileBarcode(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permette di ricaricare lo stesso file
    if (!file) return;

    if (!isBarcodeDetectorAvailable()) {
      setCameraError(
        "Questo browser non espone la decodifica barcode nativa. Inserisci il codice manualmente.",
      );
      setState("NOT_FOUND");
      return;
    }

    setState("LOOKING");
    setCameraError(null);

    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const hit = await detectBestBarcode(bitmap, bitmap.width, bitmap.height, {
        maxDimension: 1600,
      });

      if (hit && hit.validated) {
        await processBarcode(hit.rawValue);
        return;
      }
      if (hit) {
        // Letto ma non valido-GS1: mostriamo come "da confermare" senza pretendere
        // che il prodotto esista — spesso è un barcode parzialmente ostruito.
        setManualCode(hit.rawValue);
        setCameraError(
          `Ho letto "${hit.rawValue}" ma non supera il check digit GS1. Verifica il codice e correggilo se serve.`,
        );
        setState("NOT_FOUND");
        return;
      }

      setCameraError(
        "Nessun barcode leggibile nell'immagine. Prova con una foto più nitida, senza riflessi, con il codice ben centrato e che occupi almeno un terzo dell'inquadratura.",
      );
      setState("NOT_FOUND");
    } catch (err) {
      console.error("[barcode] decodifica file fallita:", err);
      setState("DEGRADED");
    } finally {
      bitmap?.close();
    }
  }

  function confirmCandidate() {
    if (!candidate) return;
    setForm({
      name: candidate.name,
      brand: candidate.brand,
      unit: candidate.unit,
      category: candidate.category,
      calories: candidate.calories,
      protein: candidate.protein,
      carbs: candidate.carbs,
      fat: candidate.fat,
      fiber: candidate.fiber,
    });
    setState("CONFIRMED");
  }

  function handleSave() {
    onAdd({
      name: form.name ?? manualCode ?? "Prodotto sconosciuto",
      brand: form.brand,
      batches: [{ quantity: Number(qty), expiryDate: expiry || undefined }],
      unit: form.unit ?? "pz",
      location: loc,
      category: form.category ?? "Altro",
      calories: form.calories,
      protein: form.protein,
      carbs: form.carbs,
      fat: form.fat,
      fiber: form.fiber,
    });
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => { stopCamera(); onBack(); }} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button>
        <h3 className="text-lg font-light flex-1" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Scansiona barcode</h3>
      </div>

      {/* IDLE */}
      {state === "IDLE" && (
        <div className="space-y-4">
          <button
            onClick={startCamera}
            className="w-full py-4 rounded-2xl flex flex-col items-center gap-2 transition-all hover:opacity-80"
            style={{ backgroundColor: "#fff", border: "2px dashed #d8cfc0" }}
          >
            <span className="text-4xl">📷</span>
            <p className="font-medium text-sm" style={{ color: "#1a1510" }}>Avvia fotocamera</p>
            <p className="text-xs" style={{ color: "#6b5e4e" }}>Punta la fotocamera verso il codice a barre del prodotto</p>
          </button>
          {cameraError && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
              {cameraError}
            </div>
          )}
          <div className="text-center text-xs" style={{ color: "#d8cfc0" }}>oppure</div>
          <label className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all hover:opacity-80" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}>
            <span>🖼️</span>
            <span className="text-sm font-medium" style={{ color: "#6b5e4e" }}>Carica immagine con barcode</span>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileBarcode} />
          </label>
          <div className="flex gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Inserisci codice manualmente"
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}
            />
            <button
              onClick={() => manualCode && processBarcode(manualCode)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{ backgroundColor: "#c4623a", color: "#fff" }}
            >
              Cerca
            </button>
          </div>
        </div>
      )}

      {/* SCANNING */}
      {state === "SCANNING" && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: "4/3" }}>
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {/* Viewfinder overlay: coincide all'incirca con la ROI 60%×35% del preprocessing */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[60%] h-[35%] border-2 rounded-xl" style={{ borderColor: "#c4623a", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
            </div>
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <p className="text-white text-xs">Punta verso il codice a barre</p>
            </div>
          </div>
          <button onClick={() => { stopCamera(); setState("IDLE"); }} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
            Annulla scansione
          </button>
        </div>
      )}

      {/* LOOKING — waiting on local DB / worker / Open Food Facts */}
      {state === "LOOKING" && (
        <div className="space-y-4 text-center py-10">
          <div className="w-10 h-10 mx-auto rounded-full animate-spin" style={{ border: "3px solid #ede6d6", borderTopColor: "#c4623a" }} />
          <p className="text-sm" style={{ color: "#6b5e4e" }}>Ricerca del codice {manualCode}…</p>
          <p className="text-xs" style={{ color: "#6b5e4e" }}>Controllo prima il catalogo locale, poi Open Food Facts se necessario.</p>
        </div>
      )}

      {/* CANDIDATE — requires explicit confirmation */}
      {state === "CANDIDATE" && candidate && (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-3 text-xs font-medium" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
            Codice rilevato: {manualCode} · fonte: {candidate.provenanceQuality === "VERIFIED" ? "catalogo locale" : "Open Food Facts"}
          </div>
          <div className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
            <div className="flex items-start gap-3">
              {candidate.photoUrl && (
                <img src={candidate.photoUrl} alt={candidate.name} className="w-14 h-14 rounded-xl object-cover shrink-0" style={{ border: "1px solid #d8cfc0" }} />
              )}
              <div className="flex items-start justify-between gap-2 flex-1">
                <div>
                  <p className="font-semibold" style={{ color: "#1a1510" }}>{candidate.name}</p>
                  {candidate.brand && <p className="text-sm" style={{ color: "#6b5e4e" }}>{candidate.brand}</p>}
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                  style={{
                    backgroundColor: candidate.provenanceQuality === "VERIFIED" ? "#dceadd" : "#faecd4",
                    color: candidate.provenanceQuality === "VERIFIED" ? "#3d6641" : "#92400e",
                  }}
                >
                  {candidate.provenanceQuality === "VERIFIED"
                    ? "verificato"
                    : candidate.provenanceQuality === "UNKNOWN"
                      ? "dati incompleti"
                      : "importato da Open Food Facts"}
                </span>
              </div>
            </div>
            {candidate.calories !== undefined && (
              <div className="grid grid-cols-5 gap-1 pt-1">
                {[
                  { l: "kcal", v: candidate.calories },
                  { l: "prot.", v: candidate.protein ?? 0 },
                  { l: "carb.", v: candidate.carbs ?? 0 },
                  { l: "grassi", v: candidate.fat ?? 0 },
                  { l: "fibre", v: candidate.fiber ?? 0 },
                ].map((n) => (
                  <div key={n.l} className="text-center rounded-lg py-1.5" style={{ backgroundColor: "#f5f0e8" }}>
                    <p className="text-xs font-semibold" style={{ color: "#1a1510" }}>{n.v}</p>
                    <p className="text-[9px]" style={{ color: "#6b5e4e" }}>{n.l}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs" style={{ color: "#6b5e4e" }}>
            Questi dati provengono da una fonte esterna. Verifica che corrispondano al prodotto prima di caricarli in dispensa.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setState("MANUAL_REQUIRED")} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
              Correggi
            </button>
            <button onClick={confirmCandidate} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
              Carica in dispensa
            </button>
          </div>
        </div>
      )}

      {/* NOT_FOUND */}
      {state === "NOT_FOUND" && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 text-center space-y-2" style={{ backgroundColor: "#f0ddd5" }}>
            <p className="font-medium text-sm" style={{ color: "#c4623a" }}>Prodotto non trovato</p>
            <p className="text-xs" style={{ color: "#6b5e4e" }}>
              Il codice <strong>{manualCode}</strong> non è presente né nel catalogo locale né su Open Food Facts. Inserisci i dati manualmente: verranno salvati e collegati a questo codice per le prossime scansioni.
            </p>
          </div>
          {cameraError && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
              {cameraError}
            </div>
          )}
          <button onClick={() => { setForm({}); setState("MANUAL_REQUIRED"); }} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
            Inserisci manualmente
          </button>
          <button onClick={() => { setCameraError(null); setState("IDLE"); }} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
            Riprova la scansione
          </button>
        </div>
      )}

      {/* DEGRADED */}
      {state === "DEGRADED" && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 text-center space-y-2" style={{ backgroundColor: "#faecd4" }}>
            <p className="font-medium text-sm" style={{ color: "#92400e" }}>
              Verifica non riuscita
            </p>
            <p className="text-xs" style={{ color: "#6b5e4e" }}>
              {cameraError ?? (
                <>
                  Non è stato possibile verificare il codice <strong>{manualCode}</strong>.
                  Riprova tra poco oppure inserisci i dati manualmente.
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => processBarcode(manualCode)}
            className="w-full py-2.5 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "#c4623a", color: "#fff" }}
          >
            Riprova
          </button>
          <button
            onClick={() => { setForm({}); setState("MANUAL_REQUIRED"); }}
            className="w-full py-2.5 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}
          >
            Inserisci manualmente
          </button>
          <button
            onClick={() => { setCameraError(null); setState("IDLE"); }}
            className="w-full py-2.5 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "transparent", color: "#6b5e4e" }}
          >
            Annulla
          </button>
        </div>
      )}

      {/* MANUAL_REQUIRED or CONFIRMED — inline form */}
      {(state === "MANUAL_REQUIRED" || state === "CONFIRMED") && (
        <ConfirmForm
          initial={form}
          qty={qty}
          setQty={setQty}
          loc={loc}
          setLoc={setLoc}
          expiry={expiry}
          setExpiry={setExpiry}
          onSave={handleSave}
          onCancel={() => setState("CANDIDATE")}
          submitLabel="Carica in dispensa"
          isConfirm={state === "CONFIRMED"}
        />
      )}
    </div>
  );
}

// ── Photo capture ──────────────────────────────────────────────────────────────
function PhotoCapture({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) {
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm" style={{color:"#6b5e4e"}}>← Indietro</button>
        <h3 className="text-lg font-light flex-1" style={{fontFamily:"var(--font-display)",color:"#1a1510"}}>Foto prodotto</h3>
      </div>
      <div className="rounded-2xl p-4 text-sm leading-relaxed" style={{backgroundColor:"#faecd4",color:"#92400e"}}>
        <p className="font-medium mb-1">Acquisizione foto</p>
        <p className="text-xs">Il backend espone il catalogo e la risoluzione barcode, ma non un servizio Vision AI per riconoscere immagini. Per evitare risultati simulati, usa l'inserimento manuale oppure la scansione barcode.</p>
      </div>
      <ManualForm onAdd={onAdd} onBack={onBack} />
    </div>
  );
}

// ── Manual form ────────────────────────────────────────────────────────────────
function ManualForm({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("g");
  const [loc, setLoc] = useState<StorageLocation>("dispensa");
  const [category, setCategory] = useState("Altro");
  const [expiry, setExpiry] = useState("");
  const [reorder, setReorder] = useState("");
  const [submitState, setSubmitState] = useState<ActionState>("IDLE");

  function handleSave() {
    if (!name) return;
    setSubmitState("SUBMITTING");
    onAdd({ name, brand: brand || undefined, batches: [{ quantity: Number(qty), expiryDate: expiry || undefined }], unit, location: loc, category, reorderPoint: reorder ? Number(reorder) : undefined });
    setSubmitState("SUCCESS");
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button>
        <h3 className="text-lg font-light flex-1" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Inserimento manuale</h3>
      </div>
      {submitState === "SUCCESS" && (
        <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>
          Prodotto caricato in dispensa ✓
        </div>
      )}
      {submitState !== "SUCCESS" && (
        <>
          {[
            { label: "Nome *", val: name, set: setName, type: "text", placeholder: "Es. Carote" },
            { label: "Marca", val: brand, set: setBrand, type: "text", placeholder: "Opzionale" },
            { label: "Quantità *", val: qty, set: setQty, type: "number", placeholder: "1" },
            { label: "Unità", val: unit, set: setUnit, type: "text", placeholder: "g / pz / ml…" },
            { label: "Scadenza", val: expiry, set: setExpiry, type: "date", placeholder: "" },
            { label: "Categoria", val: category, set: setCategory, type: "text", placeholder: "Verdure" },
            { label: "Soglia riordino", val: reorder, set: setReorder, type: "number", placeholder: "Es. 200" },
          ].map((f) => (
            <div key={f.label}>
              <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>{f.label}</label>
              <input
                type={f.type}
                value={f.val}
                placeholder={f.placeholder}
                onChange={(e) => f.set(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#c4623a")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d8cfc0")}
              />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>Luogo</label>
            <select value={loc} onChange={(e) => setLoc(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}>
              {LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onBack} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Annulla</button>
            <button
              onClick={handleSave}
              disabled={!name || submitState === "SUBMITTING"}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ backgroundColor: submitState === "SUBMITTING" || !name ? "#d8cfc0" : "#c4623a", color: "#fff" }}
            >
              {submitState === "SUBMITTING" ? "Salvataggio…" : "Carica in dispensa"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Import list ────────────────────────────────────────────────────────────────
function ImportList({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  function parseList() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    setParsed(lines);
  }

  function importAll() {
    parsed.forEach((name) => {
      onAdd({ name, batches: [{ quantity: 1 }], unit: "pz", location: "dispensa", category: "Altro" });
    });
    setDone(true);
  }

  if (done) {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-2xl p-6 text-center space-y-2" style={{ backgroundColor: "#dceadd" }}>
          <p className="text-2xl">✓</p>
          <p className="font-medium text-sm" style={{ color: "#3d6641" }}>{parsed.length} prodotti caricati in dispensa</p>
        </div>
        <button onClick={onBack} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Chiudi</button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button>
        <h3 className="text-lg font-light flex-1" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Importa lista</h3>
      </div>
      <p className="text-xs" style={{ color: "#6b5e4e" }}>Incolla una lista di prodotti, uno per riga. Verranno aggiunti alla dispensa come prodotti manuali da verificare.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={"Latte\nUova\nParmigiano\nPomodori…"}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
        style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#c4623a")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "#d8cfc0")}
      />
      {parsed.length === 0 ? (
        <button onClick={parseList} disabled={!text.trim()} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: text.trim() ? "#c4623a" : "#d8cfc0", color: "#fff" }}>
          Analizza lista
        </button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
            {parsed.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#faf7f2", borderBottom: i < parsed.length - 1 ? "1px solid #f0ebe0" : "none" }}>
                <span className="text-xs" style={{ color: "#5a7a5e" }}>✓</span>
                <span className="text-sm" style={{ color: "#1a1510" }}>{p}</span>
              </div>
            ))}
          </div>
          <button onClick={importAll} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
            Carica {parsed.length} prodotti in dispensa
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared confirm form ────────────────────────────────────────────────────────
function ConfirmForm({
  initial, qty, setQty, loc, setLoc, expiry, setExpiry, onSave, onCancel, submitLabel, isConfirm,
}: {
  initial: Partial<StockItem>; qty: string; setQty: (v: string) => void;
  loc: StorageLocation; setLoc: (v: StorageLocation) => void;
  expiry: string; setExpiry: (v: string) => void;
  onSave: () => void; onCancel: () => void;
  submitLabel: string; isConfirm: boolean;
}) {
  return (
    <div className="space-y-4">
      {isConfirm && (
        <div className="rounded-xl px-4 py-2 text-xs font-medium" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>
          Dati confermati — completa le informazioni aggiuntive
        </div>
      )}
      <div className="rounded-2xl p-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
        <p className="font-semibold text-sm" style={{ color: "#1a1510" }}>{initial.name}</p>
        {initial.brand && <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>{initial.brand}</p>}
      </div>
      {[
        { label: "Quantità", val: qty, set: setQty, type: "number" },
        { label: "Scadenza", val: expiry, set: setExpiry, type: "date" },
      ].map((f) => (
        <div key={f.label}>
          <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>{f.label}</label>
          <input type={f.type} value={f.val} onChange={(e) => f.set(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }} />
        </div>
      ))}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>Luogo</label>
        <select value={loc} onChange={(e) => setLoc(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}>
          {LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
        </select>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Indietro</button>
        <button onClick={onSave} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>{submitLabel}</button>
      </div>
    </div>
  );
}