import { useState } from "react";
import type { FamilyMember, Role } from "../types";
import { pendingInvite, FAMILY_NAME } from "../mockData";
import type { Invite } from "../types";
import { colors, fonts } from "../tokens";
import { ROLE_LABELS, ROLE_DESC } from "../utils/roles";
import { roleColors } from "../tokens";
import { Modal, ConfirmModal } from "../components/ui/Modal";
import AvatarUI from "../components/ui/Avatar";
import { RowList, Row } from "../components/ui/ListRow";
import SectionHeading from "../components/ui/SectionHeading";
import EmptyState from "../components/ui/EmptyState";
import { timeUntil } from "../utils/time";

interface Props {
  members: FamilyMember[];
  setMembers: React.Dispatch<React.SetStateAction<FamilyMember[]>>;
  currentUserId: string;
  canManage: boolean;
  isOwner: boolean;
  /** Fire-and-forget hook to sync a locally-created invite to the backend (no-op in demo mode). */
  onInviteCreated?: (invite: Invite) => void;
}

function QRPlaceholder({ code, expiresAt }: { code: string; expiresAt: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-4 rounded-2xl" style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
      <div className="w-36 h-36 rounded-xl flex items-center justify-center overflow-hidden" style={{ backgroundColor: colors.cream, border: `1px dashed ${colors.border}` }}>
        <div className="grid gap-0.5 p-1" style={{ gridTemplateColumns: "repeat(9, 1fr)" }}>
          {Array.from({ length: 81 }, (_, i) => {
            const x = i % 9; const y = Math.floor(i / 9);
            const isCorner = (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5);
            const isFinder = isCorner && !(x === 1 && y === 1) && !(x === 7 && y === 1) && !(x === 1 && y === 7);
            const isData = !isCorner && ((i + parseInt(code.replace("-", ""), 10)) % 3 !== 0);
            return <div key={i} className="rounded-sm" style={{ width: 13, height: 13, backgroundColor: isFinder || isData ? colors.ink : colors.cream }} />;
          })}
        </div>
      </div>
      <p className="text-xs" style={{ color: colors.inkMuted }}>Inquadra con la fotocamera</p>
      <div className="w-full pt-2" style={{ borderTop: `1px solid ${colors.borderLight}` }}>
        <p className="text-[10px] text-center mb-1" style={{ color: colors.inkMuted }}>Codice alternativo</p>
        <p className="text-2xl font-mono text-center font-semibold tracking-widest" style={{ color: colors.ink }}>{code}</p>
        <p className="text-[10px] text-center mt-1" style={{ color: colors.terracotta }}>Scade in {timeUntil(expiresAt)}</p>
      </div>
    </div>
  );
}

export default function Famiglia({ members, setMembers, currentUserId, canManage, isOwner, onInviteCreated }: Props) {
  const [invite, setInvite] = useState<Invite | null>(pendingInvite);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newRole, setNewRole] = useState<Role>("MEMBER");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [consentRevoked, setConsentRevoked] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [changeRoleFor, setChangeRoleFor] = useState<FamilyMember | null>(null);
  const [newRoleValue, setNewRoleValue] = useState<Role>("MEMBER");

  const currentUser = members.find((m) => m.id === currentUserId) ?? members[0];
  const activeOwners = members.filter((m) => m.role === "OWNER" && m.status === "ACTIVE");
  const activeMembers = members.filter((m) => m.status !== "REMOVED");
  const removedMembers = members.filter((m) => m.status === "REMOVED");

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

  function confirmRemove(id: string) {
    setRemovingId(id);
    setTimeout(() => {
      setMembers((m) => m.map((mem) => mem.id === id ? { ...mem, status: "REMOVED" as const } : mem));
      setRemovingId(null);
      setRemoveConfirmId(null);
    }, 700);
  }

  function confirmRoleChange() {
    if (!changeRoleFor) return;
    setMembers((m) => m.map((mem) => mem.id === changeRoleFor.id ? { ...mem, role: newRoleValue } : mem));
    setChangeRoleFor(null);
  }

  const removeTarget = members.find((m) => m.id === removeConfirmId);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>{FAMILY_NAME}</h2>
        <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>{activeMembers.length} membri attivi</p>
      </div>

      {!canManage && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
          Sei un {ROLE_LABELS[currentUser?.role ?? "VIEWER"]}. Solo il proprietario e il gestore possono modificare la famiglia.
        </div>
      )}

      {/* Active members */}
      <div className="space-y-2">
        <SectionHeading>Membri</SectionHeading>
        <RowList>
          {activeMembers.map((m, idx) => {
            const rc = roleColors[m.role];
            const isCurrentUser = m.id === currentUserId;
            const canRemoveThis = canManage && !isCurrentUser && !(m.role === "OWNER" && activeOwners.length <= 1);
            const isRemoving = removingId === m.id;
            return (
              <Row key={m.id} index={idx} last={idx === activeMembers.length - 1} style={{ opacity: isRemoving ? 0.5 : 1, transition: "opacity 0.3s" }}>
                <AvatarUI initials={m.avatar} size={9} role={m.role} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium" style={{ color: colors.ink }}>{m.name}</p>
                    {isCurrentUser && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>tu</span>}
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: colors.inkMuted }}>{m.email}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0" style={{ backgroundColor: rc.bg, color: rc.color }}>
                  {ROLE_LABELS[m.role]}
                </span>
                {canManage && !isCurrentUser && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => { setChangeRoleFor(m); setNewRoleValue(m.role); }}
                      className="text-[10px] px-2 py-1 rounded-lg transition-all hover:opacity-80"
                      style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
                      aria-label={`Cambia ruolo di ${m.name}`}
                    >
                      Ruolo
                    </button>
                    {canRemoveThis && (
                      <button
                        onClick={() => setRemoveConfirmId(m.id)}
                        className="text-[10px] px-2 py-1 rounded-lg transition-all hover:opacity-80"
                        style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}
                        aria-label={`Rimuovi ${m.name} dalla famiglia`}
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                )}
              </Row>
            );
          })}
        </RowList>
      </div>

      {/* Removed members */}
      {removedMembers.length > 0 && (
        <div className="space-y-2">
          <SectionHeading>Rimossi</SectionHeading>
          <RowList>
            {removedMembers.map((m, idx) => (
              <Row key={m.id} index={idx} last={idx === removedMembers.length - 1} style={{ opacity: 0.5 }}>
                <AvatarUI initials={m.avatar} size={8} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: colors.inkMuted, textDecoration: "line-through" }}>{m.name}</p>
                  <p className="text-[10px]" style={{ color: colors.inkMuted }}>{ROLE_LABELS[m.role]} · rimosso</p>
                </div>
              </Row>
            ))}
          </RowList>
        </div>
      )}

      {/* Inviti */}
      {canManage && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>Inviti</SectionHeading>
            <button onClick={() => setShowInviteModal(true)} className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all hover:opacity-80" style={{ backgroundColor: colors.terracotta, color: colors.white }}>
              Crea invito
            </button>
          </div>
          {invite?.status === "CREATED" ? (
            <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-sm" style={{ color: colors.ink }}>Invito attivo — {ROLE_LABELS[invite.role]}</p>
                  <p className="text-xs mt-0.5" style={{ color: colors.terracotta }}>Scade in {timeUntil(invite.expiresAt)}</p>
                </div>
                <button onClick={() => setInvite(null)} className="text-xs px-2.5 py-1 rounded-lg" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>Revoca</button>
              </div>
              <QRPlaceholder code={invite.fallbackCode} expiresAt={invite.expiresAt} />
            </div>
          ) : (
            <EmptyState title="Nessun invito attivo" description="Crea un invito per aggiungere un membro alla famiglia." />
          )}
        </div>
      )}

      {/* Privacy */}
      <div className="space-y-3">
        <SectionHeading>Privacy e dati</SectionHeading>
        <RowList>
          <Row index={0}>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: colors.ink }}>Personalizzazione ricette</p>
              <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>Consenso alla profilazione delle abitudini alimentari</p>
            </div>
            <button onClick={() => setConsentRevoked((v) => !v)} className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all" style={{ backgroundColor: consentRevoked ? colors.creamDark : colors.sageLight, color: consentRevoked ? colors.inkMuted : colors.sageDark }}>
              {consentRevoked ? "Revocato" : "Attivo"}
            </button>
          </Row>
          <Row index={1}>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: colors.ink }}>Esporta dati famiglia</p>
              <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>File ZIP con dispensa, spesa e movimenti</p>
            </div>
            <button disabled={!isOwner} className="px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ backgroundColor: isOwner ? colors.amberLight : colors.creamDark, color: isOwner ? colors.amberDark : colors.disabled }} title={!isOwner ? "Riservato al proprietario" : ""}>
              Esporta
            </button>
          </Row>
          <Row index={2} last>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: colors.ink }}>Cancella tutti i dati</p>
              <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>Rimozione definitiva — richiede doppia conferma</p>
            </div>
            <button disabled={!isOwner} onClick={() => isOwner && setShowDeleteConfirm(true)} className="px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ backgroundColor: isOwner ? colors.terracottaLight : colors.creamDark, color: isOwner ? colors.terracotta : colors.disabled }} title={!isOwner ? "Riservato al proprietario" : ""}>
              Cancella
            </button>
          </Row>
        </RowList>
        {!isOwner && <p className="text-xs" style={{ color: colors.inkMuted }}>Export e cancellazione dati riservati al proprietario della famiglia.</p>}
      </div>

      {/* Remove confirm modal */}
      {removeConfirmId && removeTarget && (
        <ConfirmModal
          title={`Rimuovere ${removeTarget.name}?`}
          message={`${removeTarget.name} non potrà più accedere alla dispensa di famiglia. Potrai invitarlo di nuovo in futuro.`}
          confirmLabel={removingId === removeConfirmId ? "Rimozione…" : "Rimuovi"}
          destructive
          loading={removingId === removeConfirmId}
          onConfirm={() => confirmRemove(removeConfirmId)}
          onCancel={() => setRemoveConfirmId(null)}
        />
      )}

      {/* Change role modal */}
      {changeRoleFor && (
        <Modal onClose={() => setChangeRoleFor(null)}>
          <div className="p-6 space-y-5">
            <h3 className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>
              Cambia ruolo — {changeRoleFor.name.split(" ")[0]}
            </h3>
            <div className="space-y-2">
              {(["MANAGER", "MEMBER", "VIEWER"] as Role[]).map((r) => {
                const rc = roleColors[r];
                return (
                  <button
                    key={r}
                    onClick={() => setNewRoleValue(r)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all"
                    style={{ backgroundColor: newRoleValue === r ? rc.bg : colors.creamDark, border: newRoleValue === r ? `1.5px solid ${rc.color}` : "1.5px solid transparent" }}
                  >
                    <div>
                      <p className="text-sm font-semibold" style={{ color: colors.ink }}>{ROLE_LABELS[r]}</p>
                      <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>{ROLE_DESC[r]}</p>
                    </div>
                    {newRoleValue === r && <span className="text-xs font-bold" style={{ color: rc.color }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setChangeRoleFor(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>Annulla</button>
              <button onClick={confirmRoleChange} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ backgroundColor: colors.terracotta, color: colors.white }}>Salva ruolo</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Invite modal */}
      {showInviteModal && (
        <Modal onClose={() => setShowInviteModal(false)}>
          <div className="p-6 space-y-5">
            <h3 className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Crea invito</h3>
            <div>
              <label className="text-xs font-medium block mb-2" style={{ color: colors.inkMuted }}>Ruolo proposto</label>
              <div className="space-y-2">
                {(["MANAGER", "MEMBER", "VIEWER"] as Role[]).map((r) => (
                  <button key={r} onClick={() => setNewRole(r)} className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all" style={{ backgroundColor: newRole === r ? colors.terracottaLight : colors.creamDark, border: newRole === r ? `1px solid ${colors.terracotta}` : "1px solid transparent" }}>
                    <span className="text-sm font-medium" style={{ color: colors.ink }}>{ROLE_LABELS[r]}</span>
                    <span className="text-xs" style={{ color: colors.inkMuted }}>{ROLE_DESC[r]}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs" style={{ color: colors.inkMuted }}>L'invito è valido per 48 ore. Chi lo riceve può accettare o rifiutare prima di entrare.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowInviteModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>Annulla</button>
              <button onClick={createInvite} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ backgroundColor: colors.terracotta, color: colors.white }}>Genera invito</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm (two-step) */}
      {showDeleteConfirm && (
        <Modal onClose={() => { setShowDeleteConfirm(false); setDeleteStep(1); }} variant="dialog" maxWidth="max-w-sm">
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-light" style={{ fontFamily: fonts.display, color: colors.terracotta }}>
              {deleteStep === 1 ? "Cancellare i dati?" : "Conferma finale"}
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: colors.ink }}>
              {deleteStep === 1
                ? "Tutti i dati della famiglia verranno cancellati definitivamente. Questa azione non può essere annullata."
                : "Stai per avviare la cancellazione definitiva di tutti i dati. Non sarà possibile recuperarli."}
            </p>
            <div className="flex gap-3">
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteStep(1); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>Annulla</button>
              {deleteStep === 1
                ? <button onClick={() => setDeleteStep(2)} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>Continua</button>
                : <button onClick={() => { setShowDeleteConfirm(false); setDeleteStep(1); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ backgroundColor: colors.terracotta, color: colors.white }}>Cancella definitivamente</button>
              }
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
