import { useState, useRef, useEffect, useCallback } from "react";
import type { StockItem, StorageLocation, ActionState } from "../types";

// ── Mock barcode database ──────────────────────────────────────────────────────
const BARCODE_DB: Record<string, Partial<StockItem> & { confidence: number; source: string }> = {
  "8076800105063": { name: "Pasta Barilla Rigatoni", brand: "Barilla", unit: "g", category: "Cereali", calories: 352, protein: 12, carbs: 70, fat: 1.5, fiber: 3, confidence: 0.97, source: "Open Food Facts" },
  "8001120748485": { name: "Parmigiano Reggiano DOP", brand: "Grana Padano", unit: "g", category: "Latticini", calories: 392, protein: 33, carbs: 0, fat: 28, fiber: 0, confidence: 0.92, source: "Open Food Facts" },
  "8001830002681": { name: "Olio Extra Vergine di Oliva", brand: "Monini", unit: "ml", category: "Condimenti", calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, confidence: 0.89, source: "Open Food Facts" },
  "8000050012117": { name: "Latte Intero UHT", brand: "Granarolo", unit: "ml", category: "Latticini", calories: 64, protein: 3.2, carbs: 4.8, fat: 3.6, fiber: 0, confidence: 0.95, source: "Open Food Facts" },
};

// Simulated photo recognition candidates
const PHOTO_CANDIDATES = [
  [
    { name: "Pomodori pelati", confidence: 0.82, source: "Vision AI" },
    { name: "Pomodori interi", confidence: 0.71, source: "Vision AI" },
  ],
  [
    { name: "Petto di pollo", confidence: 0.88, source: "Vision AI" },
    { name: "Fesa di tacchino", confidence: 0.61, source: "Vision AI" },
  ],
  [
    { name: "Pasta integrale", confidence: 0.79, source: "Vision AI" },
    { name: "Pasta semola", confidence: 0.74, source: "Vision AI" },
  ],
];

type AddMode = "menu" | "manuale" | "barcode" | "foto" | "lista";
type BarcodeState = "IDLE" | "SCANNING" | "CANDIDATE" | "MANUAL_REQUIRED" | "NOT_FOUND" | "DEGRADED" | "CONFIRMED";
type PhotoState = "IDLE" | "UPLOADING" | "PENDING_REVIEW" | "MANUAL_REQUIRED" | "CONFIRMED";

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
  const [candidate, setCandidate] = useState<(typeof BARCODE_DB)[string] | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [form, setForm] = useState<Partial<StockItem>>({});
  const [qty, setQty] = useState("1");
  const [loc, setLoc] = useState<StorageLocation>("dispensa");
  const [expiry, setExpiry] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanIntervalRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  async function startCamera() {
    setState("SCANNING");
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // Try BarcodeDetector API
      if ("BarcodeDetector" in window) {
        const detector = new (window as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (img: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "code_128"] });
        scanIntervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              stopCamera();
              processBarcode(codes[0].rawValue);
            }
          } catch {
            // continue scanning
          }
        }, 400);
      } else {
        // BarcodeDetector not available — offer file fallback
        stopCamera();
        setCameraError("Il browser non supporta la scansione automatica. Usa il file sottostante.");
        setState("IDLE");
      }
    } catch {
      stopCamera();
      setCameraError("Impossibile accedere alla fotocamera. Controlla i permessi del browser.");
      setState("IDLE");
    }
  }

  function processBarcode(code: string) {
    setManualCode(code);
    const found = BARCODE_DB[code];
    if (found) {
      setCandidate(found);
      setState("CANDIDATE");
    } else {
      setState("NOT_FOUND");
    }
  }

  function handleFileBarcode(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setState("SCANNING");
    // Simulate lookup delay
    setTimeout(() => {
      // Randomly pick a known product for demo
      const codes = Object.keys(BARCODE_DB);
      const code = codes[Math.floor(Math.random() * codes.length)];
      processBarcode(code);
    }, 1200);
  }

  function confirmCandidate() {
    if (!candidate) return;
    setForm({ name: candidate.name, brand: candidate.brand, unit: candidate.unit, category: candidate.category, calories: candidate.calories, protein: candidate.protein, carbs: candidate.carbs, fat: candidate.fat, fiber: candidate.fiber });
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
            {/* Viewfinder overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-52 h-32 border-2 rounded-xl" style={{ borderColor: "#c4623a", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
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

      {/* CANDIDATE — requires explicit confirmation */}
      {state === "CANDIDATE" && candidate && (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-3 text-xs font-medium" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
            Codice rilevato: {manualCode} · fonte: {candidate.source}
          </div>
          <div className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold" style={{ color: "#1a1510" }}>{candidate.name}</p>
                {candidate.brand && <p className="text-sm" style={{ color: "#6b5e4e" }}>{candidate.brand}</p>}
              </div>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                style={{ backgroundColor: candidate.confidence >= 0.9 ? "#dceadd" : "#faecd4", color: candidate.confidence >= 0.9 ? "#3d6641" : "#92400e" }}
              >
                {Math.round(candidate.confidence * 100)}% fiducia · {candidate.confidence >= 0.9 ? "verificato" : "importato"}
              </span>
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
            <p className="text-xs" style={{ color: "#6b5e4e" }}>Il codice <strong>{manualCode}</strong> non è presente nel database. Inserisci i dati manualmente.</p>
          </div>
          <button onClick={() => { setForm({}); setState("MANUAL_REQUIRED"); }} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
            Inserisci manualmente
          </button>
          <button onClick={() => setState("IDLE")} className="w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
            Riprova la scansione
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
  const [state, setPhotoState] = useState<PhotoState>("IDLE");
  const [preview, setPreview] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ name: string; confidence: number; source: string }[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loc, setLoc] = useState<StorageLocation>("frigo");
  const [qty, setQty] = useState("1");
  const [expiry, setExpiry] = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setPhotoState("UPLOADING");
    setTimeout(() => {
      setPhotoState("PENDING_REVIEW");
      const group = PHOTO_CANDIDATES[Math.floor(Math.random() * PHOTO_CANDIDATES.length)];
      setCandidates(group);
    }, 1500);
  }

  function selectCandidate(name: string) {
    setChosen(name);
    setPhotoState("CONFIRMED");
  }

  function handleSave() {
    onAdd({
      name: chosen ?? "Prodotto da foto",
      batches: [{ quantity: Number(qty), expiryDate: expiry || undefined }],
      unit: "pz",
      location: loc,
      category: "Altro",
    });
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button>
        <h3 className="text-lg font-light flex-1" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Foto prodotto</h3>
      </div>

      {state === "IDLE" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4 text-sm leading-relaxed" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
            <p className="font-medium mb-1">Come funziona</p>
            <p className="text-xs">Scatta una foto allo scontrino o al prodotto. Il riconoscimento propone dei candidati che dovrai sempre confermare prima che entrino in dispensa.</p>
          </div>
          <label
            className="w-full py-6 rounded-2xl flex flex-col items-center gap-3 cursor-pointer transition-all hover:opacity-80"
            style={{ backgroundColor: "#fff", border: "2px dashed #d8cfc0" }}
          >
            <span className="text-4xl">🖼️</span>
            <div className="text-center">
              <p className="font-medium text-sm" style={{ color: "#1a1510" }}>Scatta o carica una foto</p>
              <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>JPG o PNG · max 10 MB</p>
            </div>
            <input type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" onChange={handleFile} />
          </label>
        </div>
      )}

      {state === "UPLOADING" && (
        <div className="space-y-4">
          {preview && <img src={preview} alt="Anteprima" className="w-full rounded-2xl object-cover" style={{ maxHeight: 220 }} />}
          <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: "#ede6d6" }}>
            <span className="text-lg animate-spin">⏳</span>
            <div>
              <p className="text-sm font-medium" style={{ color: "#1a1510" }}>Analisi in corso…</p>
              <p className="text-xs" style={{ color: "#6b5e4e" }}>Riconoscimento del prodotto tramite Vision AI</p>
            </div>
          </div>
        </div>
      )}

      {state === "PENDING_REVIEW" && (
        <div className="space-y-4">
          {preview && <img src={preview} alt="Foto caricata" className="w-full rounded-2xl object-cover" style={{ maxHeight: 180 }} />}
          <div className="rounded-xl px-4 py-2 text-xs font-medium" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>
            Analisi completata · ogni candidato richiede conferma prima di entrare in dispensa
          </div>
          <p className="text-sm font-semibold" style={{ color: "#1a1510" }}>Quale prodotto hai fotografato?</p>
          <div className="space-y-2">
            {candidates.map((c) => (
              <button
                key={c.name}
                onClick={() => selectCandidate(c.name)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all hover:opacity-80"
                style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}
              >
                <span className="text-sm font-medium" style={{ color: "#1a1510" }}>{c.name}</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: c.confidence >= 0.8 ? "#dceadd" : "#faecd4", color: c.confidence >= 0.8 ? "#3d6641" : "#92400e" }}
                >
                  {Math.round(c.confidence * 100)}% · {c.source}
                </span>
              </button>
            ))}
            <button
              onClick={() => setPhotoState("MANUAL_REQUIRED")}
              className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}
            >
              Nessuno di questi — inserisci manualmente
            </button>
          </div>
        </div>
      )}

      {state === "MANUAL_REQUIRED" && (
        <ManualForm onAdd={onAdd} onBack={() => setPhotoState("PENDING_REVIEW")} />
      )}

      {state === "CONFIRMED" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4 space-y-1" style={{ backgroundColor: "#dceadd" }}>
            <p className="text-xs font-medium" style={{ color: "#3d6641" }}>Prodotto confermato</p>
            <p className="text-lg font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>{chosen}</p>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>Quantità</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }} />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>Scadenza</label>
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }} />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "#6b5e4e" }}>Luogo</label>
            <select value={loc} onChange={(e) => setLoc(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}>
              {LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setPhotoState("PENDING_REVIEW")} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Indietro</button>
            <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Carica in dispensa</button>
          </div>
        </div>
      )}
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
    setTimeout(() => {
      onAdd({ name, brand: brand || undefined, batches: [{ quantity: Number(qty), expiryDate: expiry || undefined }], unit, location: loc, category, reorderPoint: reorder ? Number(reorder) : undefined });
      setSubmitState("SUCCESS");
    }, 600);
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
