import { colors, freshnessColor, provenanceColor, confidenceColor } from "../../tokens";
import type { ExpiryStatus, ProvenanceQuality, ConfidenceLabel } from "../../types";

interface BadgeProps {
  label: string;
  bg: string;
  color: string;
  className?: string;
}

function BaseBadge({ label, bg, color, className = "" }: BadgeProps) {
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${className}`}
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}

export function ExpiryBadge({ status, days }: { status: ExpiryStatus; days: number | null }) {
  if (days === null) return null;
  const color = freshnessColor[status];
  const bg =
    status === "EXPIRED" ? colors.expiredBg :
    status === "EXPIRING" ? colors.expiringBg :
    colors.freshBg;
  const label = days <= 0 ? "Scaduto" : status === "EXPIRING" ? `${days}g` : `${days}g`;
  return <BaseBadge label={label} bg={bg} color={color} />;
}

export function ProvenanceBadge({ quality }: { quality: ProvenanceQuality }) {
  const p = provenanceColor[quality];
  return <BaseBadge label={p.label} bg={p.bg} color={p.color} />;
}

export function ConfidenceBadge({ confidence, label: customLabel }: { confidence: ConfidenceLabel; label?: string }) {
  const c = confidenceColor[confidence];
  return <BaseBadge label={customLabel ?? c.label} bg={c.bg} color={c.color} />;
}

export function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    OWNER: { bg: colors.terracottaLight, color: colors.terracotta, label: "Proprietario" },
    MANAGER: { bg: colors.amberLight, color: colors.amberDark, label: "Gestore" },
    MEMBER: { bg: colors.sageLight, color: colors.sageDark, label: "Membro" },
    VIEWER: { bg: colors.creamDark, color: colors.inkMuted, label: "Visualizzatore" },
  };
  const s = map[role] ?? map.VIEWER;
  return <BaseBadge label={s.label} bg={s.bg} color={s.color} />;
}

export function ScoreBadge({ matched, total }: { matched: number; total: number }) {
  const pct = Math.round((matched / total) * 100);
  const bg = pct === 100 ? colors.sageLight : pct >= 60 ? colors.amberLight : colors.terracottaLight;
  const color = pct === 100 ? colors.sageDark : pct >= 60 ? colors.amberDark : colors.terracotta;
  return <BaseBadge label={`${matched}/${total} ingredienti`} bg={bg} color={color} />;
}

export function TagBadge({ label }: { label: string }) {
  return <BaseBadge label={label} bg={colors.sageLight} color={colors.sageDark} />;
}

export function SourceBadge({ sourceType }: { sourceType: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    MANUAL: { bg: colors.creamDark, color: colors.ink, label: "aggiunto a mano" },
    REORDER: { bg: colors.amberLight, color: colors.amberDark, label: "scorta bassa" },
    OFFER: { bg: colors.sageLight, color: colors.sageDark, label: "offerta" },
    RECIPE: { bg: colors.creamDark, color: colors.inkMuted, label: "da ricetta" },
  };
  const s = map[sourceType] ?? map.MANUAL;
  return <BaseBadge label={s.label} bg={s.bg} color={s.color} />;
}
