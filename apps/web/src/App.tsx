import { useState, useEffect } from "react";
import type { StockItem } from "./types";
import { useInventory } from "./hooks/useInventory";
import { useShoppingList } from "./hooks/useShoppingList";
import { useNotifications } from "./hooks/useNotifications";
import { useFamily } from "./hooks/useFamily";
import Oggi from "./pages/Oggi";
import Dispensa from "./pages/Dispensa";
import Spesa from "./pages/Spesa";
import Ricette from "./pages/Ricette";
import Nutrienti from "./pages/Nutrienti";
import Famiglia from "./pages/Famiglia";
import Notifiche from "./pages/Notifiche";

type Tab = "oggi" | "dispensa" | "spesa" | "ricette" | "nutrienti" | "famiglia" | "notifiche";

const NAV = [
  { key: "oggi" as Tab, label: "Oggi", icon: "🏠" },
  { key: "dispensa" as Tab, label: "Dispensa", icon: "🏺" },
  { key: "spesa" as Tab, label: "Spesa", icon: "🛒" },
  { key: "ricette" as Tab, label: "Ricette", icon: "👨‍🍳" },
  { key: "nutrienti" as Tab, label: "Nutrienti", icon: "📊" },
  { key: "famiglia" as Tab, label: "Famiglia", icon: "👥" },
  { key: "notifiche" as Tab, label: "Notifiche", icon: "🔔" },
];

function expiryDays(batches: StockItem["batches"]): number | null {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  return Math.ceil((Math.min(...dates.map((d) => new Date(d).getTime())) - Date.now()) / 86400000);
}

export default function App() {
  const [tab, setTab] = useState<Tab>("oggi");
  const [isOffline, setIsOffline] = useState(false);

  const inventory = useInventory();
  const shopping = useShoppingList();
  const { notifications, setNotifications, isDemo: notificationsDemo } = useNotifications();
  const family = useFamily();

  const stock = inventory.stock;
  const setStock = inventory.setStock;
  const shoppingList = shopping.list;
  const setShoppingList = shopping.setList;

  // Simulate offline detection
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const expiredCount = stock.filter((s) => {
    const d = expiryDays(s.batches);
    return d !== null && d <= 0;
  }).length;
  const expiringCount = stock.filter((s) => {
    const d = expiryDays(s.batches);
    return d !== null && d > 0 && d <= 5;
  }).length;
  const unreadNotifs = notifications.filter((n) => !n.readAt).length;

  const urgentBadge = expiredCount + expiringCount;
  const currentUser = family.members.find((m) => m.id === family.currentUserId) ?? family.members[0];
  const isAnyDemo = inventory.isDemo || shopping.isDemo || notificationsDemo || family.isDemo;
  const isLoading = inventory.loading || shopping.loading || family.loading;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#f5f0e8", fontFamily: "var(--font-sans)" }}>
      {/* Offline banner */}
      {isOffline && (
        <div className="px-4 py-2 text-center text-xs font-medium" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
          Sei offline. Le modifiche verranno sincronizzate appena torni online.
        </div>
      )}

      {/* Backend connection banner */}
      {!isOffline && !isLoading && isAnyDemo && (
        <div
          className="px-4 py-2 text-center text-xs font-medium"
          style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}
          title="L'app tenta le chiamate reali definite in docs/openapi.yaml; finché il backend non risponde, mostra dati demo."
        >
          Modalità demo: backend non raggiungibile su {import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api/v1"}. Dati di esempio in uso.
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <nav
          className="hidden sm:flex flex-col w-52 shrink-0 py-6 px-3"
          style={{ backgroundColor: "#f5f0e8", borderRight: "1px solid #d8cfc0" }}
        >
          {/* Logo */}
          <div className="px-3 mb-8">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🫙</span>
              <span className="text-lg font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Dispensa</span>
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: "#6b5e4e" }}>{family.familyName}</p>
          </div>

          {/* Nav items */}
          <div className="flex-1 space-y-1">
            {NAV.map((n) => {
              const isActive = tab === n.key;
              const badge = n.key === "oggi" && urgentBadge > 0 ? urgentBadge : n.key === "notifiche" && unreadNotifs > 0 ? unreadNotifs : 0;
              return (
                <button
                  key={n.key}
                  onClick={() => setTab(n.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all"
                  style={{ backgroundColor: isActive ? "#ede6d6" : "transparent", color: isActive ? "#1a1510" : "#6b5e4e" }}
                >
                  <span className="text-base">{n.icon}</span>
                  <span className="flex-1">{n.label}</span>
                  {badge > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* User */}
          <div className="mt-4 px-3 pt-4" style={{ borderTop: "1px solid #d8cfc0" }}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: "#f0ddd5", color: "#c4623a" }}>
                {currentUser?.avatar ?? "?"}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "#1a1510" }}>{currentUser?.name.split(" ")[0] ?? ""}</p>
                <p className="text-[10px]" style={{ color: "#6b5e4e" }}>Proprietario</p>
              </div>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 pb-24 sm:pb-6">
            {tab === "oggi" && <Oggi stock={stock} shopping={shoppingList} onNavigate={(t) => setTab(t as Tab)} />}
            {tab === "dispensa" && <Dispensa stock={stock} setStock={setStock} />}
            {tab === "spesa" && <Spesa list={shoppingList} setList={setShoppingList} />}
            {tab === "ricette" && <Ricette stock={stock} setList={setShoppingList} />}
            {tab === "nutrienti" && <Nutrienti stock={stock} />}
            {tab === "famiglia" && (
              <Famiglia
                members={family.members}
                currentUserId={family.currentUserId}
                onInviteCreated={family.syncInviteCreated}
              />
            )}
            {tab === "notifiche" && <Notifiche notifications={notifications} setNotifications={setNotifications} />}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around px-1 py-2"
        style={{ backgroundColor: "#f5f0e8", borderTop: "1px solid #d8cfc0", zIndex: 40 }}
      >
        {NAV.map((n) => {
          const isActive = tab === n.key;
          const badge = n.key === "oggi" && urgentBadge > 0 ? urgentBadge : n.key === "notifiche" && unreadNotifs > 0 ? unreadNotifs : 0;
          return (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-all min-w-[44px] min-h-[44px] justify-center relative"
              style={{ color: isActive ? "#c4623a" : "#6b5e4e" }}
              aria-label={n.label}
            >
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[9px] font-medium">{n.label}</span>
              {badge > 0 && (
                <span
                  className="absolute top-0.5 right-0.5 text-[8px] font-bold px-1 py-0.5 rounded-full min-w-[14px] text-center leading-none"
                  style={{ backgroundColor: "#c4623a", color: "#fff" }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
