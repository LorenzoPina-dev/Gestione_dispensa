import { useState } from "react";
import type { Notification } from "../types";
import { colors, fonts } from "../tokens";
import { timeAgo } from "../utils/time";
import EmptyState from "../components/ui/EmptyState";
import SectionHeading from "../components/ui/SectionHeading";
import { RowList } from "../components/ui/ListRow";

const CAT_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  REORDER: { label: "Riordino", icon: "🛒", color: colors.amberDark, bg: colors.amberLight },
  INVITE: { label: "Inviti", icon: "👥", color: colors.sageDark, bg: colors.sageLight },
  SYSTEM: { label: "Sistema", icon: "⚙️", color: colors.inkMuted, bg: colors.creamDark },
};

type CatFilter = "REORDER" | "INVITE" | "SYSTEM" | "tutte";

interface Props {
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
}

export default function Notifiche({ notifications, setNotifications }: Props) {
  const [catFilter, setCatFilter] = useState<CatFilter>("tutte");

  const unread = notifications.filter((n) => !n.readAt).length;
  const filtered = notifications.filter((n) => catFilter === "tutte" || n.category === catFilter);

  function markRead(id: string) {
    setNotifications((ns) =>
      ns.map((n) => n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)
    );
  }

  function markAllRead() {
    setNotifications((ns) => ns.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Notifiche</h2>
          {unread > 0 && (
            <p className="text-xs mt-0.5" style={{ color: colors.terracotta }}>
              {unread} non lett{unread > 1 ? "e" : "a"}
            </p>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs px-3 py-1.5 rounded-xl font-medium"
            style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
          >
            Segna tutte come lette
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filtra per categoria">
        {[
          { key: "tutte" as CatFilter, label: "Tutte" },
          ...Object.entries(CAT_META).map(([k, v]) => ({ key: k as CatFilter, label: `${v.icon} ${v.label}` })),
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setCatFilter(f.key)}
            aria-pressed={catFilter === f.key}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              backgroundColor: catFilter === f.key ? colors.ink : colors.creamDark,
              color: catFilter === f.key ? colors.cream : colors.inkMuted,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="Nessuna notifica"
          description="Quando ci saranno aggiornamenti, li troverai qui."
        />
      ) : (
        <RowList>
          {filtered.map((n, idx) => {
            const meta = CAT_META[n.category];
            const isUnread = !n.readAt;
            return (
              // Clicking the entire card marks it read — more natural UX
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className="w-full flex items-stretch gap-0 text-left transition-colors hover:opacity-90"
                style={{
                  backgroundColor: isUnread ? colors.white : colors.creamMid,
                  borderBottom: idx < filtered.length - 1 ? `1px solid ${colors.borderLight}` : "none",
                }}
                aria-label={isUnread ? `Segna come letta: ${n.title}` : n.title}
              >
                {/* Unread accent strip */}
                <div
                  className="w-1 shrink-0 self-stretch"
                  style={{ backgroundColor: isUnread ? colors.terracotta : "transparent" }}
                />
                <div className="flex-1 px-4 py-4 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: meta.bg, color: meta.color }}
                    >
                      {meta.icon} {meta.label}
                    </span>
                    <span className="text-[10px]" style={{ color: colors.inkMuted }}>{timeAgo(n.createdAt)}</span>
                    {isUnread && (
                      <span
                        className="w-2 h-2 rounded-full ml-auto"
                        style={{ backgroundColor: colors.terracotta }}
                        aria-label="Non letta"
                      />
                    )}
                  </div>
                  <p className="text-sm font-semibold" style={{ color: colors.ink }}>{n.title}</p>
                  <p className="text-xs leading-relaxed" style={{ color: colors.inkMuted }}>{n.body}</p>
                </div>
              </button>
            );
          })}
        </RowList>
      )}

      {/* Preferences teaser */}
      <div className="rounded-2xl p-4" style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
        <SectionHeading>Preferenze</SectionHeading>
        <p className="text-xs mt-2" style={{ color: colors.inkMuted }}>
          Gestisci canali (in-app, email, push), categorie e orari di silenzio nelle impostazioni del profilo.
        </p>
      </div>
    </div>
  );
}
