import { useState, useMemo } from "react";
import type { StockItem, StorageLocation, ExpiryStatus } from "../types";
import AddProductModal from "../components/AddProductModal";

const LOCATIONS: { key: StorageLocation; label: string; icon: string }[] = [
  { key: "frigo", label: "Frigo", icon: "❄️" },
  { key: "freezer", label: "Freezer", icon: "🧊" },
  { key: "dispensa", label: "Dispensa", icon: "🏺" },
  { key: "altro", label: "Altro", icon: "📦" },
];

function getExpiryStatus(batches: StockItem["batches"]): ExpiryStatus {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return "UNKNOWN";
  const minDays = Math.min(...dates.map((d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)));
  if (minDays <= 0) return "EXPIRED";
  if (minDays <= 5) return "EXPIRING";
  return "FRESH";
}

function expiryDays(batches: StockItem["batches"]): number | null {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  return Math.ceil((Math.min(...dates.map((d) => new Date(d).getTime())) - Date.now()) / 86400000);
}

const expiryBorder: Record<ExpiryStatus, string> = {
  EXPIRED: "#c4623a",
  EXPIRING: "#d4943a",
  FRESH: "#5a7a5e",
  UNKNOWN: "#d8cfc0",
};

const provenanceBadge: Record<string, { label: string; color: string; bg: string }> = {
  VERIFIED: { label: "verificato", color: "#3d6641", bg: "#dceadd" },
  IMPORTED: { label: "importato", color: "#92400e", bg: "#faecd4" },
  ESTIMATED: { label: "stimato", color: "#6b5e4e", bg: "#ede6d6" },
  UNKNOWN: { label: "fonte ignota", color: "#6b5e4e", bg: "#ede6d6" },
};

interface Props {
  stock: StockItem[];
  setStock: React.Dispatch<React.SetStateAction<StockItem[]>>;
}

export default function Dispensa({ stock, setStock }: Props) {
  const [locFilter, setLocFilter] = useState<StorageLocation | "tutti">("tutti");
  const [statusFilter, setStatusFilter] = useState<ExpiryStatus | "tutti">("tutti");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<StockItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    return stock
      .filter((s) => {
        const st = getExpiryStatus(s.batches);
        const totalQty = s.batches.reduce((a, b) => a + b.quantity, 0);
        const isLow = s.reorderPoint !== undefined && totalQty <= s.reorderPoint;
        const matchLoc = locFilter === "tutti" || s.location === locFilter;
        const matchStatus =
          statusFilter === "tutti" ||
          st === statusFilter ||
          (statusFilter === "EXPIRING" && isLow);
        const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
        return matchLoc && matchStatus && matchSearch;
      })
      .sort((a, b) => {
        const order: Record<ExpiryStatus, number> = { EXPIRED: 0, EXPIRING: 1, FRESH: 2, UNKNOWN: 3 };
        return order[getExpiryStatus(a.batches)] - order[getExpiryStatus(b.batches)];
      });
  }, [stock, locFilter, statusFilter, search]);

  const grouped = useMemo(() => {
    const locs = locFilter === "tutti" ? LOCATIONS.map((l) => l.key) : [locFilter as StorageLocation];
    return locs.map((loc) => ({
      loc,
      items: filtered.filter((s) => s.location === loc),
    })).filter((g) => g.items.length > 0);
  }, [filtered, locFilter]);

  const expiredCount = stock.filter((s) => getExpiryStatus(s.batches) === "EXPIRED").length;
  const expiringCount = stock.filter((s) => getExpiryStatus(s.batches) === "EXPIRING").length;

  function handleAddFromModal(item: Omit<StockItem, "id" | "version" | "provenance">) {
    const newItem: StockItem = { ...item, id: "si_" + Date.now(), version: 1, provenance: "VERIFIED" };
    setStock((p) => [...p, newItem]);
    setShowAdd(false);
  }

  function handleConsume(id: string, qty: number) {
    setStock((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const total = s.batches.reduce((a, b) => a + b.quantity, 0);
        if (total - qty <= 0) return { ...s, batches: [{ ...s.batches[0], quantity: 0 }] };
        return { ...s, batches: [{ ...s.batches[0], quantity: total - qty }], version: s.version + 1 };
      })
    );
  }

  const locInfo = (loc: StorageLocation) => LOCATIONS.find((l) => l.key === loc)!;

  // Detail panel
  if (detail) {
    const st = getExpiryStatus(detail.batches);
    const days = expiryDays(detail.batches);
    const prov = provenanceBadge[detail.provenance];
    const totalQty = detail.batches.reduce((a, b) => a + b.quantity, 0);
    return (
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm font-medium hover:opacity-60 transition-opacity" style={{ color: "#6b5e4e" }}>
          ← Torna alla dispensa
        </button>
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
          <div className="h-2 w-full" style={{ backgroundColor: expiryBorder[st] }} />
          <div className="p-6 space-y-5" style={{ backgroundColor: "#fff" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>{detail.name}</h2>
                {detail.brand && <p className="text-sm" style={{ color: "#6b5e4e" }}>{detail.brand}</p>}
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: prov.bg, color: prov.color }}>
                {prov.label}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Quantità", value: `${totalQty} ${detail.unit}` },
                { label: "Luogo", value: `${locInfo(detail.location).icon} ${locInfo(detail.location).label}` },
                { label: "Versione", value: `v${detail.version}` },
              ].map((r) => (
                <div key={r.label} className="rounded-xl p-3" style={{ backgroundColor: "#f5f0e8" }}>
                  <p className="text-xs" style={{ color: "#6b5e4e" }}>{r.label}</p>
                  <p className="text-sm font-semibold mt-0.5" style={{ color: "#1a1510" }}>{r.value}</p>
                </div>
              ))}
            </div>

            {days !== null && (
              <div className="rounded-xl p-3 flex items-center gap-3" style={{ backgroundColor: st === "EXPIRED" ? "#f0ddd5" : st === "EXPIRING" ? "#faecd4" : "#dceadd" }}>
                <span className="text-lg">{st === "EXPIRED" ? "⚠️" : st === "EXPIRING" ? "📅" : "✓"}</span>
                <div>
                  <p className="text-sm font-medium" style={{ color: expiryBorder[st] }}>
                    {st === "EXPIRED" ? "Scaduto" : st === "EXPIRING" ? `Scade in ${days} giorni` : `Fresco ancora ${days} giorni`}
                  </p>
                  <p className="text-xs" style={{ color: "#6b5e4e" }}>
                    {new Date(detail.batches[0].expiryDate!).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
              </div>
            )}

            {detail.calories !== undefined && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Valori per 100g</p>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: "kcal", value: detail.calories },
                    { label: "prot.", value: detail.protein ?? 0 },
                    { label: "carb.", value: detail.carbs ?? 0 },
                    { label: "grassi", value: detail.fat ?? 0 },
                    { label: "fibre", value: detail.fiber ?? 0 },
                  ].map((n) => (
                    <div key={n.label} className="rounded-lg p-2 text-center" style={{ backgroundColor: "#f5f0e8" }}>
                      <p className="text-sm font-semibold" style={{ color: "#1a1510" }}>{n.value}</p>
                      <p className="text-[10px]" style={{ color: "#6b5e4e" }}>{n.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { handleConsume(detail.id, 1); setDetail(null); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>
                Consuma
              </button>
              <button onClick={() => { setStock((p) => p.filter((s) => s.id !== detail.id)); setDetail(null); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80" style={{ backgroundColor: "#f0ddd5", color: "#c4623a" }}>
                Scarta come spreco
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Dispensa</h2>
          {(expiredCount > 0 || expiringCount > 0) && (
            <p className="text-xs mt-0.5" style={{ color: "#c4623a" }}>
              {expiredCount > 0 && `${expiredCount} scadut${expiredCount > 1 ? "i" : "o"}`}
              {expiredCount > 0 && expiringCount > 0 && " · "}
              {expiringCount > 0 && `${expiringCount} in scadenza`}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80"
          style={{ backgroundColor: "#c4623a", color: "#fff" }}
        >
          + Aggiungi
        </button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cerca nella dispensa…"
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
        style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#c4623a")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "#d8cfc0")}
      />

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "tutti", label: "Tutti" },
          { key: "EXPIRED", label: "⚠️ Scaduti" },
          { key: "EXPIRING", label: "📅 In scadenza" },
          { key: "FRESH", label: "✓ Freschi" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key as ExpiryStatus | "tutti")}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{ backgroundColor: statusFilter === f.key ? "#1a1510" : "#ede6d6", color: statusFilter === f.key ? "#f5f0e8" : "#6b5e4e" }}
          >
            {f.label}
          </button>
        ))}
        <span style={{ color: "#d8cfc0" }}>|</span>
        {LOCATIONS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLocFilter(locFilter === l.key ? "tutti" : l.key)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{ backgroundColor: locFilter === l.key ? "#1a1510" : "#ede6d6", color: locFilter === l.key ? "#f5f0e8" : "#6b5e4e" }}
          >
            {l.icon} {l.label}
          </button>
        ))}
      </div>

      {/* Grouped list */}
      {grouped.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: "#ede6d6" }}>
          <p className="font-medium text-sm" style={{ color: "#6b5e4e" }}>Nessun prodotto trovato</p>
          <p className="text-xs mt-1" style={{ color: "#6b5e4e" }}>Prova a cambiare i filtri o aggiungi un prodotto.</p>
        </div>
      )}
      {grouped.map(({ loc, items }) => (
        <div key={loc} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>
            {locInfo(loc).icon} {locInfo(loc).label}
          </p>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
            {items.map((item, idx) => {
              const st = getExpiryStatus(item.batches);
              const days = expiryDays(item.batches);
              const totalQty = item.batches.reduce((a, b) => a + b.quantity, 0);
              const isLow = item.reorderPoint !== undefined && totalQty <= item.reorderPoint;
              return (
                <button
                  key={item.id}
                  onClick={() => setDetail(item)}
                  className="w-full flex items-center gap-0 text-left transition-colors hover:bg-opacity-50"
                  style={{
                    backgroundColor: idx % 2 === 0 ? "#fff" : "#faf7f2",
                    borderBottom: idx < items.length - 1 ? "1px solid #f0ebe0" : "none",
                  }}
                >
                  {/* Freshness tab */}
                  <div className="w-1 self-stretch rounded-none shrink-0" style={{ backgroundColor: expiryBorder[st] }} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" style={{ color: "#1a1510" }}>{item.name}</span>
                        {item.brand && <span className="text-[10px]" style={{ color: "#6b5e4e" }}>{item.brand}</span>}
                        {isLow && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>scorte basse</span>}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>
                        {totalQty} {item.unit}
                        {days !== null && (
                          <span style={{ color: st === "EXPIRED" ? "#c4623a" : st === "EXPIRING" ? "#d4943a" : "#6b5e4e" }}>
                            {" · "}
                            {days <= 0 ? "scaduto" : `scade in ${days}g`}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: "#d8cfc0" }}>›</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {showAdd && (
        <AddProductModal onClose={() => setShowAdd(false)} onAdd={handleAddFromModal} />
      )}
    </div>
  );
}
