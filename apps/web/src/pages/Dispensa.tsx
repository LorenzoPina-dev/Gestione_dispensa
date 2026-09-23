import { useState, useMemo } from "react";
import type { StockItem, StorageLocation, ExpiryStatus } from "../types";
import AddProductModal from "../components/AddProductModal";
import { Modal } from "../components/ui/Modal";
import { colors, fonts, freshnessColor, provenanceColor } from "../tokens";
import { Input } from "../components/ui/Input";

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

function totalQuantity(item: StockItem): number {
  return item.batches.reduce((sum, b) => sum + b.quantity, 0);
}

interface Props {
  stock: StockItem[];
  setStock: React.Dispatch<React.SetStateAction<StockItem[]>>;
  readOnly?: boolean;
}

export default function Dispensa({ stock, setStock, readOnly = false }: Props) {
  const [locFilter, setLocFilter] = useState<StorageLocation | "tutti">("tutti");
  const [statusFilter, setStatusFilter] = useState<ExpiryStatus | "tutti">("tutti");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<StockItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Consume modal state
  const [consumeTarget, setConsumeTarget] = useState<StockItem | null>(null);
  const [consumeQty, setConsumeQty] = useState("1");
  const [consumeError, setConsumeError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return stock
      .filter((s) => {
        const st = getExpiryStatus(s.batches);
        const totalQty = totalQuantity(s);
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

  function openConsumeModal(item: StockItem) {
    setConsumeTarget(item);
    setConsumeQty("1");
    setConsumeError(null);
  }

  function closeConsumeModal() {
    setConsumeTarget(null);
    setConsumeQty("1");
    setConsumeError(null);
  }

  function handleConsumeConfirm() {
    if (!consumeTarget) return;
    const qty = Number(consumeQty);
    const available = totalQuantity(consumeTarget);

    if (!Number.isFinite(qty) || qty <= 0) {
      setConsumeError("Inserisci una quantità maggiore di zero.");
      return;
    }
    if (qty > available) {
      setConsumeError(
        `Quantità non disponibile: hai solo ${available} ${consumeTarget.unit}.`,
      );
      return;
    }

    // Consumo distribuito sui batches in ordine FEFO (quelli con scadenza più vicina prima),
    // esattamente come fa il backend in PostgresInventoryRepository.recordMovementAtomic.
    setStock((prev) =>
      prev.map((s) => {
        if (s.id !== consumeTarget.id) return s;
        let remaining = qty;
        const orderedBatches = [...s.batches].sort((a, b) => {
          const da = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
          const db = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
          return da - db;
        });
        const updated = orderedBatches.map((b) => {
          if (remaining <= 0) return b;
          const take = Math.min(b.quantity, remaining);
          remaining -= take;
          return { ...b, quantity: b.quantity - take };
        });
        const pruned = updated.filter((b) => b.quantity > 0);
        return {
          ...s,
          batches: pruned.length > 0 ? pruned : [{ quantity: 0 }],
          version: s.version + 1,
        };
      }),
    );

    closeConsumeModal();
    setDetail(null);
  }

  function handleWaste(item: StockItem) {
    setStock((p) => p.filter((s) => s.id !== item.id));
    setDetail(null);
  }

  const locInfo = (loc: StorageLocation) => LOCATIONS.find((l) => l.key === loc)!;

  // ── Detail panel ─────────────────────────────────────────────────────────────
  if (detail) {
    const st = getExpiryStatus(detail.batches);
    const days = expiryDays(detail.batches);
    const prov = provenanceColor[detail.provenance];
    const totalQty = totalQuantity(detail);
    return (
      <>
        <div className="space-y-6">
          <button onClick={() => setDetail(null)} className="text-sm font-medium hover:opacity-60 transition-opacity" style={{ color: colors.inkMuted }}>
            ← Torna alla dispensa
          </button>
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
            <div className="h-2 w-full" style={{ backgroundColor: freshnessColor[st] }} />
            <div className="p-6 space-y-5" style={{ backgroundColor: colors.white }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>{detail.name}</h2>
                  {detail.brand && <p className="text-sm" style={{ color: colors.inkMuted }}>{detail.brand}</p>}
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
                  <div key={r.label} className="rounded-xl p-3" style={{ backgroundColor: colors.cream }}>
                    <p className="text-xs" style={{ color: colors.inkMuted }}>{r.label}</p>
                    <p className="text-sm font-semibold mt-0.5" style={{ color: colors.ink }}>{r.value}</p>
                  </div>
                ))}
              </div>

              {days !== null && (
                <div className="rounded-xl p-3 flex items-center gap-3" style={{ backgroundColor: st === "EXPIRED" ? colors.terracottaLight : st === "EXPIRING" ? colors.amberLight : colors.sageLight }}>
                  <span className="text-lg">{st === "EXPIRED" ? "⚠️" : st === "EXPIRING" ? "📅" : "✓"}</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: freshnessColor[st] }}>
                      {st === "EXPIRED" ? "Scaduto" : st === "EXPIRING" ? `Scade in ${days} giorni` : `Fresco ancora ${days} giorni`}
                    </p>
                    <p className="text-xs" style={{ color: colors.inkMuted }}>
                      {new Date(detail.batches[0].expiryDate!).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                </div>
              )}

              {detail.calories !== undefined && (
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: colors.inkMuted }}>Valori per 100g</p>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: "kcal", value: detail.calories },
                      { label: "prot.", value: detail.protein ?? 0 },
                      { label: "carb.", value: detail.carbs ?? 0 },
                      { label: "grassi", value: detail.fat ?? 0 },
                      { label: "fibre", value: detail.fiber ?? 0 },
                    ].map((n) => (
                      <div key={n.label} className="rounded-lg p-2 text-center" style={{ backgroundColor: colors.cream }}>
                        <p className="text-sm font-semibold" style={{ color: colors.ink }}>{n.value}</p>
                        <p className="text-[10px]" style={{ color: colors.inkMuted }}>{n.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!readOnly ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => openConsumeModal(detail)}
                    disabled={totalQty <= 0}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80 disabled:opacity-40"
                    style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}
                  >
                    Consuma
                  </button>
                  <button
                    onClick={() => handleWaste(detail)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80"
                    style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}
                  >
                    Scarta come spreco
                  </button>
                </div>
              ) : (
                <div className="rounded-xl px-4 py-2.5 text-xs text-center" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
                  Sei in modalità sola lettura — non puoi modificare la dispensa
                </div>
              )}
            </div>
          </div>
        </div>

        {consumeTarget && (
          <ConsumeQuantityModal
            item={consumeTarget}
            value={consumeQty}
            error={consumeError}
            onChange={(v) => { setConsumeQty(v); setConsumeError(null); }}
            onConfirm={handleConsumeConfirm}
            onClose={closeConsumeModal}
          />
        )}
      </>
    );
  }

  // ── List ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Dispensa</h2>
          {(expiredCount > 0 || expiringCount > 0) && (
            <p className="text-xs mt-0.5" style={{ color: colors.terracotta }}>
              {expiredCount > 0 && `${expiredCount} scadut${expiredCount > 1 ? "i" : "o"}`}
              {expiredCount > 0 && expiringCount > 0 && " · "}
              {expiringCount > 0 && `${expiringCount} in scadenza`}
            </p>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80"
            style={{ backgroundColor: colors.terracotta, color: colors.white }}
          >
            + Aggiungi
          </button>
        )}
      </div>

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cerca nella dispensa…"
        className="py-2.5"
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
            style={{ backgroundColor: statusFilter === f.key ? colors.ink : colors.creamDark, color: statusFilter === f.key ? colors.cream : colors.inkMuted }}
          >
            {f.label}
          </button>
        ))}
        <span style={{ color: colors.border }}>|</span>
        {LOCATIONS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLocFilter(locFilter === l.key ? "tutti" : l.key)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{ backgroundColor: locFilter === l.key ? colors.ink : colors.creamDark, color: locFilter === l.key ? colors.cream : colors.inkMuted }}
          >
            {l.icon} {l.label}
          </button>
        ))}
      </div>

      {/* Grouped list */}
      {grouped.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: colors.creamDark }}>
          <p className="font-medium text-sm" style={{ color: colors.inkMuted }}>Nessun prodotto trovato</p>
          <p className="text-xs mt-1" style={{ color: colors.inkMuted }}>Prova a cambiare i filtri o aggiungi un prodotto.</p>
        </div>
      )}
      {grouped.map(({ loc, items }) => (
        <div key={loc} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            {locInfo(loc).icon} {locInfo(loc).label}
          </p>
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
            {items.map((item, idx) => {
              const st = getExpiryStatus(item.batches);
              const days = expiryDays(item.batches);
              const qty = totalQuantity(item);
              const isLow = item.reorderPoint !== undefined && qty <= item.reorderPoint;
              return (
                <button
                  key={item.id}
                  onClick={() => setDetail(item)}
                  className="w-full flex items-center gap-0 text-left transition-colors hover:bg-opacity-50"
                  style={{
                    backgroundColor: idx % 2 === 0 ? colors.white : colors.creamMid,
                    borderBottom: idx < items.length - 1 ? `1px solid ${colors.borderLight}` : "none",
                  }}
                >
                  <div className="w-1 self-stretch rounded-none shrink-0" style={{ backgroundColor: freshnessColor[st] }} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" style={{ color: colors.ink }}>{item.name}</span>
                        {item.brand && <span className="text-[10px]" style={{ color: colors.inkMuted }}>{item.brand}</span>}
                        {isLow && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>scorte basse</span>}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                        {qty} {item.unit}
                        {days !== null && (
                          <span style={{ color: st === "EXPIRED" ? colors.terracotta : st === "EXPIRING" ? colors.amber : colors.inkMuted }}>
                            {" · "}
                            {days <= 0 ? "scaduto" : `scade in ${days}g`}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: colors.border }}>›</span>
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

// ── Consume quantity modal ────────────────────────────────────────────────────
interface ConsumeQuantityModalProps {
  item: StockItem;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

function ConsumeQuantityModal({ item, value, error, onChange, onConfirm, onClose }: ConsumeQuantityModalProps) {
  const available = item.batches.reduce((sum, b) => sum + b.quantity, 0);

  // Valori rapidi in base all'unità: grammi/ml → step da 50/100/250, pezzi/pack → 1/2/5.
  const unit = item.unit.toLowerCase();
  const quickValues =
    unit === "g" || unit === "kg"
      ? [50, 100, 250]
      : unit === "ml" || unit === "l"
        ? [100, 250, 500]
        : [1, 2, 5];

  const parsedQty = Number(value);
  const isValid = Number.isFinite(parsedQty) && parsedQty > 0 && parsedQty <= available;

  return (
    <Modal onClose={onClose} variant="dialog" maxWidth="max-w-sm">
      <div className="p-6 space-y-5">
        <div>
          <h3 className="text-lg font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>
            Quanto ne consumi?
          </h3>
          <p className="text-sm mt-1" style={{ color: colors.inkMuted }}>
            {item.name}
          </p>
        </div>

        <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ backgroundColor: colors.cream }}>
          <span className="text-xs" style={{ color: colors.inkMuted }}>Disponibile</span>
          <span className="text-sm font-semibold" style={{ color: colors.ink }}>
            {available} {item.unit}
          </span>
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: colors.inkMuted }}>
            Quantità da consumare ({item.unit})
          </label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && isValid) onConfirm(); }}
            autoFocus
            error={error ?? undefined}
          />
          {error && (
            <p className="text-xs mt-1.5" style={{ color: colors.terracotta }}>
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {quickValues.filter((v) => v <= available).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(String(v))}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: value === String(v) ? colors.ink : colors.creamDark,
                color: value === String(v) ? colors.cream : colors.inkMuted,
              }}
            >
              {v} {item.unit}
            </button>
          ))}
          {available > 0 && (
            <button
              type="button"
              onClick={() => onChange(String(available))}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: value === String(available) ? colors.ink : colors.creamDark,
                color: value === String(available) ? colors.cream : colors.inkMuted,
              }}
            >
              tutto ({available} {item.unit})
            </button>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium"
            style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            disabled={!isValid}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
            style={{ backgroundColor: colors.sage, color: colors.white }}
          >
            Consuma
          </button>
        </div>
      </div>
    </Modal>
  );
}