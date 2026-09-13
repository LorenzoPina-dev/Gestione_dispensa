import { useState } from "react";
import type { Notification } from "../types";

const CAT_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  REORDER: { label: "Riordino", icon: "🛒", color: "#92400e", bg: "#faecd4" },
  INVITE: { label: "Inviti", icon: "👥", color: "#3d6641", bg: "#dceadd" },
  SYSTEM: { label: "Sistema", icon: "⚙️", color: "#6b5e4e", bg: "#ede6d6" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min fa`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h fa`;
  return `${Math.floor(hrs / 24)}g fa`;
}

interface Props {
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
}

export default function Notifiche({ notifications, setNotifications }: Props) {
  const [catFilter, setCatFilter] = useState<"REORDER" | "INVITE" | "SYSTEM" | "tutte">("tutte");

  const unread = notifications.filter((n) => !n.readAt).length;

  const filtered = notifications.filter((n) => catFilter === "tutte" || n.category === catFilter);

  function markRead(id: string) {
    setNotifications((ns) => ns.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
  }

  function markAllRead() {
    setNotifications((ns) => ns.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Notifiche</h2>
          {unread > 0 && <p className="text-xs mt-0.5" style={{ color: "#c4623a" }}>{unread} non lett{unread > 1 ? "e" : "a"}</p>}
        </div>
        {unread > 0 && (
          <button onClick={markAllRead} className="text-xs px-3 py-1.5 rounded-xl font-medium" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
            Segna tutte come lette
          </button>
        )}
      </div>

      {/* Category filters */}
      <div className="flex gap-2 flex-wrap">
        {[{ key: "tutte", label: "Tutte" }, ...Object.entries(CAT_META).map(([k, v]) => ({ key: k, label: `${v.icon} ${v.label}` }))].map((f) => (
          <button
            key={f.key}
            onClick={() => setCatFilter(f.key as typeof catFilter)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{ backgroundColor: catFilter === f.key ? "#1a1510" : "#ede6d6", color: catFilter === f.key ? "#f5f0e8" : "#6b5e4e" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: "#ede6d6" }}>
          <p className="font-medium text-sm" style={{ color: "#6b5e4e" }}>Nessuna notifica</p>
          <p className="text-xs mt-1" style={{ color: "#6b5e4e" }}>Quando ci saranno aggiornamenti, li troverai qui.</p>
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((n) => {
          const meta = CAT_META[n.category];
          const isUnread = !n.readAt;
          return (
            <div
              key={n.id}
              className="rounded-2xl flex gap-3 overflow-hidden transition-all"
              style={{ backgroundColor: isUnread ? "#fff" : "#faf7f2", border: `1px solid ${isUnread ? "#d8cfc0" : "#ede6d6"}` }}
            >
              {/* Unread indicator */}
              <div className="w-1 shrink-0 self-stretch" style={{ backgroundColor: isUnread ? "#c4623a" : "transparent" }} />
              <div className="flex-1 py-4 pr-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: meta.bg, color: meta.color }}>
                        {meta.icon} {meta.label}
                      </span>
                      <span className="text-[10px]" style={{ color: "#6b5e4e" }}>{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: "#1a1510" }}>{n.title}</p>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: "#6b5e4e" }}>{n.body}</p>
                  </div>
                  {isUnread && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="shrink-0 text-[10px] px-2 py-1 rounded-lg mt-1"
                      style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}
                      aria-label="Segna come letta"
                    >
                      Letta
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Preferences teaser */}
      <div className="rounded-2xl p-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
        <p className="text-sm font-medium" style={{ color: "#1a1510" }}>Preferenze notifiche</p>
        <p className="text-xs mt-1" style={{ color: "#6b5e4e" }}>Gestisci canali (in-app, email, push), categorie e orari di silenzio nelle impostazioni del profilo.</p>
      </div>
    </div>
  );
}
