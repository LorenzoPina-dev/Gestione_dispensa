import { useState } from "react";
import type { FamilyMember, Role, Invite } from "../types";
import { pendingInvite, FAMILY_NAME } from "../mockData";

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Proprietario",
  MANAGER: "Gestore",
  MEMBER: "Membro",
  VIEWER: "Visualizzatore",
};

const ROLE_DESC: Record<Role, string> = {
  OWNER: "Accesso completo, export e cancellazione dati",
  MANAGER: "Gestisce inviti, dispensa e spesa",
  MEMBER: "Modifica dispensa e spesa",
  VIEWER: "Solo lettura",
};

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const hrs = Math.ceil(diff / 3600000);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.ceil(hrs / 24)} giorni`;
}

interface Props {
  members: FamilyMember[];
  currentUserId: string;
  /** Fire-and-forget hook to sync a locally-created invite to the backend (no-op in demo mode). */
  onInviteCreated?: (invite: Invite) => void;
}

export default function Famiglia({ members, currentUserId, onInviteCreated }: Props) {
  const [invite, setInvite] = useState<Invite | null>(pendingInvite);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newRole, setNewRole] = useState<Role>("MEMBER");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [consentRevoked, setConsentRevoked] = useState(false);

  const currentUser = members.find((m) => m.id === currentUserId)!;
  const isOwner = currentUser.role === "OWNER";

  function createInvite() {
    const inv: Invite = {
      inviteId: "inv_" + Date.now(),
      role: newRole,
      status: "CREATED",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      fallbackCode: Math.floor(100000 + Math.random() * 900000).toString().replace(/(\d{3})(\d{3})/, "$1-$2"),
      createdAt: new Date().toISOString(),
    };
    setInvite(inv);
    setShowInviteModal(false);
    onInviteCreated?.(inv);
  }

  // Simple QR-code placeholder using CSS
  function QRPlaceholder({ code }: { code: string }) {
    return (
      <div className="flex flex-col items-center gap-3 p-4 rounded-2xl" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
        <div className="w-36 h-36 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#f5f0e8", border: "1px dashed #d8cfc0" }}>
          {/* Simulated QR grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: 49 }).map((_, i) => (
              <div key={i} className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: Math.random() > 0.45 ? "#1a1510" : "#f5f0e8" }} />
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: "#6b5e4e" }}>Inquadra con la fotocamera</p>
        <div className="w-full pt-2" style={{ borderTop: "1px solid #ede6d6" }}>
          <p className="text-[10px] text-center mb-1" style={{ color: "#6b5e4e" }}>Codice alternativo</p>
          <p className="text-2xl font-mono text-center font-semibold tracking-widest" style={{ color: "#1a1510" }}>{code}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>{FAMILY_NAME}</h2>
        <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>{members.filter((m) => m.status === "ACTIVE").length} membri attivi</p>
      </div>

      {/* Members */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>Membri</p>
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
          {members.map((m, idx) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#faf7f2", borderBottom: idx < members.length - 1 ? "1px solid #f0ebe0" : "none" }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                style={{ backgroundColor: "#f0ddd5", color: "#c4623a" }}
              >
                {m.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium" style={{ color: "#1a1510" }}>{m.name}</p>
                  {m.id === currentUserId && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>tu</span>}
                </div>
                <p className="text-xs" style={{ color: "#6b5e4e" }}>{ROLE_LABELS[m.role]} · {ROLE_DESC[m.role]}</p>
              </div>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: m.status === "ACTIVE" ? "#dceadd" : "#ede6d6", color: m.status === "ACTIVE" ? "#3d6641" : "#6b5e4e" }}
              >
                {m.status === "ACTIVE" ? "attivo" : m.status.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Invite section */}
      {(isOwner || currentUser.role === "MANAGER") && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>Inviti</p>
            <button
              onClick={() => setShowInviteModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-80"
              style={{ backgroundColor: "#c4623a", color: "#fff" }}
            >
              Crea invito
            </button>
          </div>

          {invite && invite.status === "CREATED" && (
            <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-sm" style={{ color: "#1a1510" }}>Invito attivo — {ROLE_LABELS[invite.role]}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#c4623a" }}>Scade in {timeUntil(invite.expiresAt)}</p>
                </div>
                <button
                  onClick={() => setInvite(null)}
                  className="text-xs px-2.5 py-1 rounded-lg"
                  style={{ backgroundColor: "#f0ddd5", color: "#c4623a" }}
                >
                  Revoca
                </button>
              </div>
              <QRPlaceholder code={invite.fallbackCode} />
            </div>
          )}
          {(!invite || invite.status !== "CREATED") && (
            <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: "#ede6d6" }}>
              <p className="text-sm" style={{ color: "#6b5e4e" }}>Nessun invito attivo.</p>
              <p className="text-xs mt-1" style={{ color: "#6b5e4e" }}>Crea un invito per aggiungere un nuovo membro alla famiglia.</p>
            </div>
          )}
        </div>
      )}

      {/* Privacy */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>Privacy e dati</p>
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
          {/* Consent */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #f0ebe0", backgroundColor: "#fff" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#1a1510" }}>Personalizzazione ricette</p>
              <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>Consenso alla profilazione delle abitudini alimentari</p>
            </div>
            <button
              onClick={() => setConsentRevoked((v) => !v)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{ backgroundColor: consentRevoked ? "#ede6d6" : "#dceadd", color: consentRevoked ? "#6b5e4e" : "#3d6641" }}
            >
              {consentRevoked ? "Revocato" : "Attivo"}
            </button>
          </div>
          {/* Export */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #f0ebe0", backgroundColor: "#faf7f2" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#1a1510" }}>Esporta dati famiglia</p>
              <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>File ZIP con dispensa, spesa e movimenti</p>
            </div>
            <button
              disabled={!isOwner}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{ backgroundColor: isOwner ? "#faecd4" : "#ede6d6", color: isOwner ? "#92400e" : "#d8cfc0" }}
              title={!isOwner ? "Riservato al proprietario" : ""}
            >
              Esporta
            </button>
          </div>
          {/* Delete */}
          <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: "#fff" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#1a1510" }}>Cancella tutti i dati</p>
              <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>Rimozione definitiva — richiede doppia conferma</p>
            </div>
            <button
              disabled={!isOwner}
              onClick={() => isOwner && setShowDeleteConfirm(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{ backgroundColor: isOwner ? "#f0ddd5" : "#ede6d6", color: isOwner ? "#c4623a" : "#d8cfc0" }}
              title={!isOwner ? "Riservato al proprietario" : ""}
            >
              Cancella
            </button>
          </div>
        </div>
        {!isOwner && <p className="text-xs" style={{ color: "#6b5e4e" }}>Export e cancellazione dati sono riservati al proprietario della famiglia.</p>}
      </div>

      {/* Invite modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: "rgba(26,21,16,0.45)" }} onClick={(e) => e.target === e.currentTarget && setShowInviteModal(false)}>
          <div className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 space-y-5" style={{ backgroundColor: "#f5f0e8" }}>
            <h3 className="text-xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Crea invito</h3>
            <div>
              <label className="text-xs font-medium block mb-2" style={{ color: "#6b5e4e" }}>Ruolo proposto</label>
              <div className="space-y-2">
                {(["MANAGER", "MEMBER", "VIEWER"] as Role[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setNewRole(r)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{ backgroundColor: newRole === r ? "#f0ddd5" : "#ede6d6", border: newRole === r ? "1px solid #c4623a" : "1px solid transparent" }}
                  >
                    <span className="text-sm font-medium" style={{ color: "#1a1510" }}>{ROLE_LABELS[r]}</span>
                    <span className="text-xs" style={{ color: "#6b5e4e" }}>{ROLE_DESC[r]}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs" style={{ color: "#6b5e4e" }}>L'invito sarà valido per 48 ore. Chi lo riceve potrà accettare o rifiutare esplicitamente prima di entrare nella famiglia.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowInviteModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Annulla</button>
              <button onClick={createInvite} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#c4623a", color: "#fff" }}>Genera invito</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: "rgba(26,21,16,0.55)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={{ backgroundColor: "#f5f0e8" }}>
            {deleteStep === 1 ? (
              <>
                <h3 className="text-lg font-light" style={{ fontFamily: "var(--font-display)", color: "#c4623a" }}>Cancellare i dati?</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#1a1510" }}>Tutti i dati della famiglia verranno cancellati definitivamente. Questa azione non può essere annullata.</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Annulla</button>
                  <button onClick={() => setDeleteStep(2)} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#f0ddd5", color: "#c4623a" }}>Continua</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-light" style={{ fontFamily: "var(--font-display)", color: "#c4623a" }}>Conferma finale</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#1a1510" }}>Stai per avviare la cancellazione definitiva di tutti i dati della famiglia. Non sarà possibile recuperarli.</p>
                <div className="flex gap-3">
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteStep(1); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>Annulla</button>
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteStep(1); alert("Richiesta di cancellazione inviata. Riceverai un email di conferma."); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{ backgroundColor: "#c4623a", color: "#fff" }}
                  >
                    Cancella definitivamente
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
