import { useState, useRef, useEffect } from "react";
import type { AuthUser } from "../../store/auth";
import type { Role } from "../../types";
import { colors, fonts } from "../../tokens";
import { Input } from "../../components/ui/Input";
import * as api from "../../api/endpoints";
import { getBrowserBindingHash } from "../../api/config";
import { isBackendUnreachable } from "../../api/client";

type Step =
  | "choose"          // create vs join
  | "create_name"     // enter family name
  | "create_done"     // family created
  | "join_scan"       // QR or code entry
  | "join_review"     // review invite details
  | "join_done";      // joined

interface Props {
  user: AuthUser;
  onComplete: (user: AuthUser) => void;
}

export default function Onboarding({ user, onComplete }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [familyName, setFamilyName] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [inviteDetails, setInviteDetails] = useState<{ familyName: string; role: string; expiresIn: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [backendNote, setBackendNote] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanActive, setScanActive] = useState(false);
  const [scanError, setScanError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);

  // Attacca lo stream della fotocamera al <video> non appena l'elemento è montato
  // (si monta solo quando scanActive diventa true).
  useEffect(() => {
    if (scanActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [scanActive]);

  // Rilascia sempre la fotocamera quando il componente viene smontato.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Shared card wrapper
  function Card({ children }: { children: React.ReactNode }) {
    return (
      <div
        className="w-full max-w-sm rounded-3xl p-7 space-y-6"
        style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}`, boxShadow: "0 4px 24px rgba(26,21,16,0.06)" }}
      >
        {children}
      </div>
    );
  }

  function Header({ title, sub }: { title: string; sub?: string }) {
    return (
      <div>
        <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>{title}</h2>
        {sub && <p className="text-sm mt-1" style={{ color: colors.inkMuted }}>{sub}</p>}
      </div>
    );
  }

  const [createError, setCreateError] = useState<string | null>(null);

  async function createFamily() {
    if (!familyName.trim()) return;
    setSubmitting(true);
    setBackendNote(null);
    setCreateError(null);
    try {
      const result = await api.createFamily({
        displayName: familyName.trim(),
        locale: "it-IT",
        timezone: "Europe/Rome",
        unitSystem: "METRIC",
      });
      const resolvedFamilyId = result.family.id;
      setSubmitting(false);
      setStep("create_done");
      setTimeout(() => {
        onComplete({ ...user, hasFamilyId: resolvedFamilyId, role: "OWNER" });
      }, 1500);
    } catch (err) {
      // Prima non c'era nessun try/catch qui: un errore del backend lasciava lo spinner
      // "Creazione in corso…" bloccato per sempre senza alcun messaggio per l'utente.
      setSubmitting(false);
      setCreateError(
        isBackendUnreachable(err)
          ? "Backend non raggiungibile. Controlla la connessione e riprova."
          : err instanceof Error
            ? err.message
            : "Errore durante la creazione della famiglia. Riprova.",
      );
    }
  }

  async function checkCode() {
    const trimmed = code.trim();
    setCodeError("");
    setSubmitting(true);
    try {
      const result = await api.resolveInviteByCode(trimmed, getBrowserBindingHash());
      setSubmitting(false);
      setAttemptId(result.id);
      setInviteDetails({ familyName: "la famiglia che ti ha invitato", role: result.role === "MANAGER" ? "Gestore" : result.role === "VIEWER" ? "Visualizzatore" : "Membro", expiresIn: "valido" });
      setStep("join_review");
    } catch {
      setSubmitting(false);
      setCodeError("Codice non trovato o scaduto. Riprova o chiedi un nuovo invito.");
    }
  }

  function stopScan() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanActive(false);
  }

  async function handleScannedValue(raw: string) {
    stopScan();
    // Se il QR contiene l'URL di join generato da QRCodeDisplay (vedi pages/Famiglia.tsx)
    // estraiamo il token dal parametro `familyInvite`; altrimenti trattiamo l'intero valore
    // scansionato come token grezzo.
    let token = raw.trim();
    try {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get("familyInvite");
      if (fromQuery) token = fromQuery;
    } catch {
      // raw non è un URL assoluto: va bene, lo usiamo così com'è
    }
    if (!token) return;
    setSubmitting(true);
    setScanError("");
    try {
      const result = await api.resolveInvite(token, getBrowserBindingHash());
      setSubmitting(false);
      setAttemptId(result.id);
      setInviteDetails({
        familyName: "la famiglia che ti ha invitato",
        role: result.role === "MANAGER" ? "Gestore" : result.role === "VIEWER" ? "Visualizzatore" : "Membro",
        expiresIn: "valido",
      });
      setStep("join_review");
    } catch {
      setSubmitting(false);
      setScanError("QR non valido o invito scaduto. Riprova a scansionare oppure inserisci il codice numerico.");
    }
  }

  function runDetectionLoop() {
    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setScanError("Il tuo browser non supporta la scansione QR nativa. Inserisci il codice numerico dell'invito qui sotto.");
      return;
    }
    if (!detectorRef.current) {
      detectorRef.current = new BarcodeDetectorCtor({ formats: ["qr_code"] });
    }
    const tick = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        if (codes.length > 0 && codes[0].rawValue) {
          handleScannedValue(codes[0].rawValue);
          return;
        }
      } catch {
        // frame non decodificabile in questo istante: si ritenta al prossimo
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function startScan() {
    setScanError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setScanActive(true);
      runDetectionLoop();
    } catch (err) {
      setScanError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Permesso fotocamera negato. Abilitalo nelle impostazioni del browser oppure inserisci il codice numerico."
          : "Impossibile accedere alla fotocamera. Inserisci il codice numerico dell'invito.",
      );
    }
  }


  function acceptInvite() {
    if (!attemptId) return;
    setSubmitting(true);
    api.acceptInvite(attemptId, "privacy-consent-v1")
      .then((result) => {
        setSubmitting(false);
        setStep("join_done");
        const grantedRole: Role = result.role === "MANAGER" ? "MANAGER" : result.role === "VIEWER" ? "VIEWER" : "MEMBER";
        setTimeout(() => onComplete({ ...user, hasFamilyId: result.familyId ?? null, role: grantedRole }), 300);
      })
      .catch((err) => {
        setSubmitting(false);
        setBackendNote(isBackendUnreachable(err) ? "Backend non raggiungibile." : "L'invito non è più valido.");
      });
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-4 py-12" style={{ backgroundColor: colors.cream }}>
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <span className="text-4xl">🫙</span>
        <p className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Dispensa</p>
      </div>

      {/* ── CHOOSE ──────────────────────────────────────────────────── */}
      {step === "choose" && (
        <Card>
          <Header
            title={`Ciao, ${user.name.split(" ")[0]}!`}
            sub="Vuoi creare una nuova famiglia o unirti a una già esistente?"
          />
          <div className="space-y-3">
            <button
              onClick={() => setStep("create_name")}
              className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:opacity-90"
              style={{ backgroundColor: colors.terracottaLight, border: "1px solid #e8cec4" }}
            >
              <span className="text-3xl w-12 h-12 flex items-center justify-center rounded-xl shrink-0" style={{ backgroundColor: colors.white }}>🏠</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: colors.ink }}>Crea una nuova famiglia</p>
                <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>Sei il primo della famiglia. Potrai invitare gli altri dopo.</p>
              </div>
            </button>
            <button
              onClick={() => setStep("join_scan")}
              className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:opacity-90"
              style={{ backgroundColor: colors.sageLight, border: "1px solid #c4d9c6" }}
            >
              <span className="text-3xl w-12 h-12 flex items-center justify-center rounded-xl shrink-0" style={{ backgroundColor: colors.white }}>📷</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: colors.ink }}>Unisciti con un invito</p>
                <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>Scansiona il QR code o inserisci il codice che ti è stato inviato.</p>
              </div>
            </button>
          </div>
        </Card>
      )}

      {/* ── CREATE NAME ─────────────────────────────────────────────── */}
      {step === "create_name" && (
        <Card>
          <button onClick={() => setStep("choose")} className="text-xs font-medium" style={{ color: colors.inkMuted }}>← Indietro</button>
          <Header title="Come si chiama la tua famiglia?" sub="Sarà il nome visibile a tutti i membri che aggiungerai." />
          {createError && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>
              {createError}
            </div>
          )}
          <Input
            label="Nome famiglia"
            type="text"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFamily()}
            placeholder="Es. Famiglia Ferretti"
            autoFocus
          />
          <div className="space-y-2">
            <button
              onClick={createFamily}
              disabled={!familyName.trim() || submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ backgroundColor: !familyName.trim() || submitting ? colors.border : colors.terracotta, color: colors.white }}
            >
              {submitting ? "Creazione in corso…" : "Crea famiglia"}
            </button>
          </div>
        </Card>
      )}

      {/* ── CREATE DONE ─────────────────────────────────────────────── */}
      {step === "create_done" && (
        <Card>
          <div className="text-center space-y-3 py-4">
            <div className="text-5xl">🎉</div>
            <p className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>
              {familyName} è pronta!
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Accesso alla dispensa in corso…
            </p>
            {backendNote && (
              <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
                {backendNote}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ── JOIN SCAN ───────────────────────────────────────────────── */}
      {step === "join_scan" && (
        <Card>
          <button onClick={() => { stopScan(); setStep("choose"); }} className="text-xs font-medium" style={{ color: colors.inkMuted }}>← Indietro</button>
          <Header title="Unisciti alla famiglia" sub="Scansiona il QR code ricevuto oppure inserisci il codice numerico." />

          {/* QR scan area */}
          <div className="space-y-3">
            {scanActive ? (
              <div className="relative rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: "1" }}>
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-44 h-44 border-2 rounded-xl" style={{ borderColor: colors.terracotta, boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }} />
                </div>
                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <p className="text-white text-xs">Inquadra il codice QR dell'invito…</p>
                </div>
                <button
                  onClick={stopScan}
                  className="absolute top-3 right-3 text-xs px-2 py-1 rounded-lg"
                  style={{ backgroundColor: "rgba(26,21,16,0.6)", color: colors.white }}
                >
                  Annulla
                </button>
              </div>
            ) : (
              <button
                onClick={startScan}
                className="w-full py-4 rounded-2xl flex flex-col items-center gap-2 transition-all hover:opacity-80"
                style={{ backgroundColor: colors.cream, border: `2px dashed ${colors.border}` }}
              >
                <span className="text-3xl">📷</span>
                <p className="text-sm font-medium" style={{ color: colors.ink }}>Scansiona QR code</p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>Usa la fotocamera del tuo dispositivo</p>
              </button>
            )}
            {scanError && <p className="text-xs" style={{ color: colors.terracotta }}>{scanError}</p>}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: colors.border }} />
            <span className="text-xs" style={{ color: colors.inkMuted }}>oppure</span>
            <div className="flex-1 h-px" style={{ backgroundColor: colors.border }} />
          </div>

          {/* Manual code */}
          <div className="space-y-3">
            <Input
              label="Codice numerico"
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeError(""); }}
              placeholder="Es. 847-291"
              className="text-center font-mono tracking-widest"
              error={codeError}
            />
            <button
              onClick={checkCode}
              disabled={!code.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ backgroundColor: !code.trim() ? colors.border : colors.ink, color: colors.white }}
            >
              Verifica codice
            </button>
          </div>


        </Card>
      )}

      {/* ── JOIN REVIEW ─────────────────────────────────────────────── */}
      {step === "join_review" && inviteDetails && (
        <Card>
          <Header title="Revisiona l'invito" sub="Controlla i dettagli prima di accettare o rifiutare." />

          <div className="space-y-3 rounded-2xl p-4" style={{ backgroundColor: colors.cream }}>
            {[
              { label: "Famiglia", value: inviteDetails.familyName },
              { label: "Ruolo proposto", value: inviteDetails.role },
              { label: "Scade tra", value: inviteDetails.expiresIn },
            ].map((r) => (
              <div key={r.label} className="flex justify-between items-center">
                <span className="text-xs" style={{ color: colors.inkMuted }}>{r.label}</span>
                <span className="text-sm font-medium" style={{ color: colors.ink }}>{r.value}</span>
              </div>
            ))}
          </div>

          <p className="text-xs leading-relaxed" style={{ color: colors.inkMuted }}>
            Accettando l'invito entri a far parte di <strong>{inviteDetails.familyName}</strong> come {inviteDetails.role}. Potrai uscire dalla famiglia in qualsiasi momento dalle impostazioni.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("join_scan")}
              className="flex-1 py-3 rounded-xl text-sm font-medium"
              style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
            >
              Rifiuta
            </button>
            <button
              onClick={acceptInvite}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ backgroundColor: submitting ? colors.border : colors.terracotta, color: colors.white }}
            >
              {submitting ? "Accettazione…" : "Accetta invito"}
            </button>
          </div>
        </Card>
      )}

      {/* ── JOIN DONE ───────────────────────────────────────────────── */}
      {step === "join_done" && inviteDetails && (
        <Card>
          <div className="text-center space-y-3 py-4">
            <div className="text-5xl">🎉</div>
            <p className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>
              Benvenuto in {inviteDetails.familyName}!
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>Accesso alla dispensa in corso…</p>
          </div>
        </Card>
      )}
    </div>
  );
}
