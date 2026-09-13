import { useState, useRef } from "react";
import type { AuthUser } from "../../store/auth";
import { colors, fonts } from "../../tokens";
import { Input } from "../../components/ui/Input";
import * as api from "../../api/endpoints";

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

// Simulated valid invite codes. The real backend only resolves invites by their secret QR token
// (see apps/api/src/family/invites.ts — there is no "look up by fallback code" endpoint), so the
// join-by-code flow below stays a local demo; only "create a family" is wired to the real
// `POST /api/v1/families` endpoint.
const VALID_CODES: Record<string, { familyName: string; role: string; expiresIn: string }> = {
  "847-291": { familyName: "Famiglia Ferretti", role: "Membro", expiresIn: "2 giorni" },
  "123-456": { familyName: "Famiglia Rossi", role: "Gestore", expiresIn: "12 ore" },
};

export default function Onboarding({ user, onComplete }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [familyName, setFamilyName] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [inviteDetails, setInviteDetails] = useState<(typeof VALID_CODES)[string] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [backendNote, setBackendNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanActive, setScanActive] = useState(false);
  const [scanError, setScanError] = useState("");

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

  /**
   * Tries the real `POST /api/v1/families` endpoint first (this is the one real "bootstrap"
   * write available — see docs comment in api/config.ts about there being no session/login
   * endpoint yet). If the backend is unreachable or rejects the call for any reason, falls back
   * to a local demo family id so onboarding still completes and the rest of the app runs in
   * demo mode, exactly like the inventory/shopping hooks do.
   */
  async function createFamily() {
    if (!familyName.trim()) return;
    setSubmitting(true);
    setBackendNote(null);
    let resolvedFamilyId: string;
    try {
      const result = await api.createFamily({
        displayName: familyName.trim(),
        locale: "it-IT",
        timezone: "Europe/Rome",
        unitSystem: "METRIC",
      });
      resolvedFamilyId = result.family.id;
    } catch {
      resolvedFamilyId = "fam_new_" + Date.now();
      setBackendNote("Backend non raggiungibile: la famiglia è stata creata solo in modalità demo.");
    }
    setSubmitting(false);
    setStep("create_done");
    setTimeout(() => {
      onComplete({ ...user, hasFamilyId: resolvedFamilyId, role: "OWNER" });
    }, 1500);
  }

  function checkCode() {
    const found = VALID_CODES[code.trim()];
    if (!found) { setCodeError("Codice non trovato o scaduto. Riprova o chiedi un nuovo invito."); return; }
    setCodeError("");
    setInviteDetails(found);
    setStep("join_review");
  }

  async function startScan() {
    setScanError("");
    setScanActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      // Simulate finding a QR after 2 seconds
      setTimeout(() => {
        stream.getTracks().forEach((t) => t.stop());
        setScanActive(false);
        const found = VALID_CODES["847-291"];
        setInviteDetails(found);
        setCode("847-291");
        setStep("join_review");
      }, 2000);
    } catch {
      setScanActive(false);
      setScanError("Impossibile accedere alla fotocamera. Inserisci il codice manualmente.");
    }
  }

  function acceptInvite() {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setStep("join_done");
      setTimeout(() => {
        onComplete({ ...user, hasFamilyId: "fam1", role: "MEMBER" });
      }, 1200);
    }, 900);
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
          <button onClick={() => { setScanActive(false); setStep("choose"); }} className="text-xs font-medium" style={{ color: colors.inkMuted }}>← Indietro</button>
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
                  onClick={() => setScanActive(false)}
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

          <p className="text-[10px] text-center" style={{ color: colors.inkMuted }}>
            Codici demo validi: <strong>847-291</strong> · <strong>123-456</strong>
          </p>
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
