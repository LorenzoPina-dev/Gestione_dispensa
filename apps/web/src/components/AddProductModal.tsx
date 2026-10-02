import { useCallback, useEffect, useRef, useState } from "react";
import type { StockItem, StorageLocation } from "../types";
import * as api from "../api/endpoints";
import { isBarcodeDetectorAvailable, detectBestBarcode, computeViewfinderCrop, type BarcodeHit } from "../lib/barcodePreprocess";
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
  provenanceQuality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
};

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
    { key: "manuale" as const, icon: "✏️", label: "Inserimento manuale", desc: "Compila i dati del prodotto a mano" },
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const lastRef = useRef({ value: "", count: 0 });
  const [state, setState] = useState<BarcodeState>("IDLE");
  const [code, setCode] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [expiry, setExpiry] = useState("");
  const [location, setLocation] = useState<StorageLocation>("dispensa");

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    lastRef.current = { value: "", count: 0 };
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function resolve(codeValue: string) {
    const normalized = codeValue.trim().replaceAll("-", "");
    setCode(normalized);
    setError(null);
    setState("LOOKING");
    try {
      const result = await api.resolveProductBarcode("BARCODE", normalized);
      if (result.status === "MATCHED" && result.product) {
        const p = result.product;
        setCandidate({ productId: p.id, name: p.canonicalName, brand: p.brand, unit: p.defaultUnit as StockItem["unit"], category: p.category, photoUrl: p.photoUrl, calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, fiber: p.fiber, provenanceQuality: p.provenanceQuality });
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

  async function scanSource(source: ImageBitmapSource, width: number, height: number) {
    if (!isBarcodeDetectorAvailable()) {
      setError("Questo browser non supporta la lettura automatica del barcode. Inserisci il codice manualmente.");
      setState("MANUAL_REQUIRED");
      return;
    }
    setState("LOOKING");
    try {
      const hit: BarcodeHit | null = await detectBestBarcode(source, width, height, { maxDimension: 1600 });
      if (!hit) { setError("Nessun barcode leggibile nell'immagine."); setState("MANUAL_REQUIRED"); return; }
      const normalized = hit.rawValue.trim().replaceAll("-", "");
      if (!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(normalized)) {
        setCode(hit.rawValue); setError("Il barcode rilevato non ha un formato supportato. Correggilo o inseriscilo manualmente."); setState("MANUAL_REQUIRED"); return;
      }
      await resolve(normalized);
    } catch (err) {
      console.error("[barcode] image scan failed", err);
      setError("Non è stato possibile leggere il barcode dall'immagine.");
      setState("MANUAL_REQUIRED");
    }
  }

  async function startCamera() {
    if (!isBarcodeDetectorAvailable()) { setError("Questo browser non supporta la scansione automatica. Usa una foto con un browser compatibile o inserisci il codice manualmente."); return; }
    setState("SCANNING"); setError(null); stoppedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (stoppedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      scheduleScan();
    } catch { stopCamera(); setError("Impossibile accedere alla fotocamera. Controlla i permessi del browser."); setState("IDLE"); }
  }

  function scheduleScan() { if (!stoppedRef.current) timerRef.current = window.setTimeout(scanFrame, 450); }
  async function scanFrame() {
    if (stoppedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) { scheduleScan(); return; }
    try {
      const crop = computeViewfinderCrop(video.videoWidth, video.videoHeight);
      const hit = await detectBestBarcode(video, video.videoWidth, video.videoHeight, { maxDimension: 900, crop });
      if (hit) {
        lastRef.current = lastRef.current.value === hit.rawValue ? { value: hit.rawValue, count: lastRef.current.count + 1 } : { value: hit.rawValue, count: 1 };
        if (lastRef.current.count >= (hit.validated ? 1 : 2)) { const found = hit.rawValue; stopCamera(); await resolve(found); return; }
      } else lastRef.current = { value: "", count: 0 };
    } catch { /* keep scanning */ }
    scheduleScan();
  }

  function confirmCandidate() {
    if (!candidate) return;
    setState("CONFIRMED");
  }

  function save() {
    if (!candidate) return;
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) { setError("La quantità deve essere maggiore di zero."); return; }
    onAdd({ productId: candidate.productId, barcode: code, name: candidate.name, brand: candidate.brand, unit: candidate.unit, category: candidate.category ?? "Altro", calories: candidate.calories, protein: candidate.protein, carbs: candidate.carbs, fat: candidate.fat, fiber: candidate.fiber, location, batches: [{ quantity, expiryDate: expiry || undefined }] });
  }

  return (
    <div className="p-4 space-y-5 sm:p-6">
      <div className="flex items-center gap-3"><button onClick={() => { stopCamera(); onBack(); }} className="text-sm" style={{ color: "#6b5e4e" }}>← Indietro</button><h3 className="text-lg font-light flex-1" style={{ color: "#1a1510" }}>Foto / barcode</h3></div>

      {state === "IDLE" && <div className="space-y-4">
        <button onClick={startCamera} className="w-full py-4 rounded-2xl flex flex-col items-center gap-2" style={{ backgroundColor: "#fff", border: "2px dashed #d8cfc0" }}><span className="text-4xl">📷</span><p className="font-medium text-sm">Scatta con la fotocamera</p><p className="text-xs" style={{ color: "#6b5e4e" }}>Inquadra il barcode del prodotto</p></button>
        <label className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}><span>🖼️</span><span className="text-sm font-medium" style={{ color: "#6b5e4e" }}>Carica una foto del barcode</span><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; const bitmap = await createImageBitmap(file); try { await scanSource(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); } }} /></label>
        <div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Inserisci barcode manualmente" className="flex-1 px-3 py-2.5 rounded-xl text-sm" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }} /><button onClick={() => code.trim() && resolve(code)} className="px-4 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Cerca</button></div>
        {error && <Message>{error}</Message>}
      </div>}

      {state === "SCANNING" && <div className="space-y-4"><div className="relative rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: "4/3" }}><video ref={videoRef} className="w-full h-full object-cover" playsInline muted /><div className="absolute inset-0 flex items-center justify-center"><div className="w-[60%] h-[35%] border-2 rounded-xl" style={{ borderColor: "#c4623a", boxShadow: "0 0 0 9999px rgba(0,0,0,.45)" }} /></div></div><button onClick={() => { stopCamera(); setState("IDLE"); }} className="w-full py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Annulla scansione</button></div>}

      {state === "LOOKING" && <div className="py-10 text-center space-y-4"><div className="w-10 h-10 mx-auto rounded-full animate-spin" style={{ border: "3px solid #ede6d6", borderTopColor: "#c4623a" }} /><p className="text-sm" style={{ color: "#6b5e4e" }}>Ricerca prodotto per barcode…</p>{code && <p className="font-mono text-sm">{code}</p>}</div>}

      {state === "CANDIDATE" && candidate && <CandidateView candidate={candidate} code={code} onCorrect={() => setState("MANUAL_REQUIRED")} onConfirm={confirmCandidate} />}

      {(state === "CONFIRMED") && candidate && <ConfirmStock candidate={candidate} qty={qty} setQty={setQty} expiry={expiry} setExpiry={setExpiry} location={location} setLocation={setLocation} onBack={() => setState("CANDIDATE")} onSave={save} />}

      {(state === "MANUAL_REQUIRED" || state === "NOT_FOUND" || state === "DEGRADED") && <div className="space-y-4"><Message>{error ?? (state === "NOT_FOUND" ? `Nessun prodotto trovato per ${code}.` : "Verifica non riuscita.")}</Message>{state === "NOT_FOUND" && <ManualProduct onAdd={onAdd} code={code} onBack={() => setState("IDLE")} />}{state !== "NOT_FOUND" && <><button onClick={() => resolve(code)} disabled={!code} className="w-full py-2.5 rounded-xl" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Riprova ricerca</button><button onClick={() => setState("NOT_FOUND")} className="w-full py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Inserisci manualmente</button></>}</div>}
    </div>
  );
}

function CandidateView({ candidate, code, onCorrect, onConfirm }: { candidate: Candidate; code: string; onCorrect: () => void; onConfirm: () => void }) {
  return <div className="space-y-4"><Message>Barcode rilevato: {code}</Message><div className="rounded-2xl p-5" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}><div className="flex gap-3">{candidate.photoUrl && <img src={candidate.photoUrl} alt={candidate.name} className="w-16 h-16 rounded-xl object-cover" />}<div><p className="font-semibold">{candidate.name}</p>{candidate.brand && <p className="text-sm" style={{ color: "#6b5e4e" }}>{candidate.brand}</p>}<p className="text-xs mt-2" style={{ color: "#6b5e4e" }}>Fonte: {candidate.provenanceQuality === "VERIFIED" ? "catalogo locale" : "Open Food Facts"}</p></div></div></div><p className="text-xs" style={{ color: "#6b5e4e" }}>Questa è solo un'anteprima. Nessun prodotto è ancora stato inserito nella scorta.</p><div className="flex gap-3"><button onClick={onCorrect} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Correggi</button><button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Conferma prodotto</button></div></div>;
}

function ConfirmStock({ candidate, qty, setQty, expiry, setExpiry, location, setLocation, onBack, onSave }: { candidate: Candidate; qty: string; setQty: (v: string) => void; expiry: string; setExpiry: (v: string) => void; location: StorageLocation; setLocation: (v: StorageLocation) => void; onBack: () => void; onSave: () => void }) {
  return <div className="space-y-4"><div className="rounded-2xl p-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}><p className="font-semibold">{candidate.name}</p>{candidate.brand && <p className="text-xs" style={{ color: "#6b5e4e" }}>{candidate.brand}</p>}</div><Field label="Quantità" type="number" value={qty} onChange={setQty} /><Field label="Scadenza" type="date" value={expiry} onChange={setExpiry} /><div><label className="text-xs font-medium block mb-1">Luogo</label><select value={location} onChange={(e) => setLocation(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}>{LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}</select></div><p className="text-xs" style={{ color: "#6b5e4e" }}>Il prodotto verrà scritto nella scorta solo premendo l'ultimo pulsante.</p><div className="flex gap-3"><button onClick={onBack} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Indietro</button><button onClick={onSave} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Inserisci nella scorta</button></div></div>;
}

function ManualProduct({ onAdd, code, onBack }: { onAdd: Props["onAdd"]; code: string; onBack: () => void }) {
  const [name, setName] = useState(""); const [qty, setQty] = useState("1"); const [expiry, setExpiry] = useState(""); const [location, setLocation] = useState<StorageLocation>("dispensa");
  return <div className="space-y-3"><Field label="Nome prodotto" value={name} onChange={setName} /><Field label="Quantità" type="number" value={qty} onChange={setQty} /><Field label="Scadenza" type="date" value={expiry} onChange={setExpiry} /><div><label className="text-xs font-medium block mb-1">Luogo</label><select value={location} onChange={(e) => setLocation(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl" style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0" }}>{LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}</select></div><div className="flex gap-3"><button onClick={onBack} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: "#ede6d6" }}>Indietro</button><button disabled={!name.trim()} onClick={() => onAdd({ name: name.trim(), barcode: code || undefined, unit: "piece", category: "Altro", location, batches: [{ quantity: Number(qty), expiryDate: expiry || undefined }] })} className="flex-1 py-2.5 rounded-xl" style={{ backgroundColor: name.trim() ? "#c4623a" : "#d8cfc0", color: "#fff" }}>Inserisci nella scorta</button></div></div>;
}

function ManualForm({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) { const [name,setName]=useState(""); const [brand,setBrand]=useState(""); const [qty,setQty]=useState("1"); const [unit,setUnit]=useState<StockItem["unit"]>("piece"); const [expiry,setExpiry]=useState(""); const [location,setLocation]=useState<StorageLocation>("dispensa"); return <div className="p-4 space-y-4 sm:p-6"><button onClick={onBack} className="text-sm">← Indietro</button><Field label="Nome" value={name} onChange={setName}/><Field label="Marca" value={brand} onChange={setBrand}/><Field label="Quantità" type="number" value={qty} onChange={setQty}/><Field label="Scadenza" type="date" value={expiry} onChange={setExpiry}/><select value={unit} onChange={(e)=>setUnit(e.target.value as StockItem["unit"])} className="w-full px-3 py-2 rounded-xl" style={{backgroundColor:"#ede6d6",border:"1px solid #d8cfc0"}}><option value="piece">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="pack">confezione</option></select><select value={location} onChange={(e)=>setLocation(e.target.value as StorageLocation)} className="w-full px-3 py-2 rounded-xl" style={{backgroundColor:"#ede6d6",border:"1px solid #d8cfc0"}}>{LOCATIONS.map(l=><option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}</select><button disabled={!name.trim()} onClick={()=>onAdd({name:name.trim(),brand:brand||undefined,unit,location,category:"Altro",batches:[{quantity:Number(qty),expiryDate:expiry||undefined}]})} className="w-full py-2.5 rounded-xl" style={{backgroundColor:name.trim()?"#c4623a":"#d8cfc0",color:"#fff"}}>Inserisci nella scorta</button></div>; }

function ImportList({ onAdd, onBack }: { onAdd: Props["onAdd"]; onBack: () => void }) { const [text,setText]=useState(""); const [done,setDone]=useState(false); const items=text.split("\n").map(x=>x.trim()).filter(Boolean); return <div className="p-4 space-y-4 sm:p-6"><button onClick={onBack} className="text-sm">← Indietro</button><textarea value={text} onChange={e=>setText(e.target.value)} rows={8} className="w-full px-3 py-2 rounded-xl" style={{backgroundColor:"#ede6d6",border:"1px solid #d8cfc0"}} placeholder="Latte\nUova\nPomodori"/><button disabled={!items.length} onClick={()=>{items.forEach(name=>onAdd({name,unit:"piece",location:"dispensa",category:"Altro",batches:[{quantity:1}]}));setDone(true)}} className="w-full py-2.5 rounded-xl" style={{backgroundColor:items.length?"#c4623a":"#d8cfc0",color:"#fff"}}>{done?"Prodotti inseriti ✓":`Inserisci ${items.length} prodotti`}</button></div>; }

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <div><label className="text-xs font-medium block mb-1" style={{color:"#6b5e4e"}}>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} className="w-full px-3 py-2 rounded-xl" style={{backgroundColor:"#ede6d6",border:"1px solid #d8cfc0",color:"#1a1510"}}/></div>; }
function Message({ children }: { children: React.ReactNode }) { return <div className="rounded-xl px-4 py-3 text-sm" style={{backgroundColor:"#faecd4",color:"#92400e"}}>{children}</div>; }
