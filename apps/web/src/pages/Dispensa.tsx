import { useState, useMemo } from "react";
import type { StockBatch, StockItem, StorageLocation, ExpiryStatus } from "../types";
import * as api from "../api/endpoints";
import AddProductModal from "../components/AddProductModal";
import { Modal } from "../components/ui/Modal";
import { colors, fonts, freshnessColor, provenanceColor } from "../tokens";
import { Input } from "../components/ui/Input";
import { convertQuantity, formatQuantity, formatUnit, isKnownUnit, normalizeUnit } from "../domain/units";

const LOCATIONS: { key: StorageLocation; label: string; icon: string }[] = [
  { key: "frigo", label: "Frigo", icon: "❄️" },
  { key: "freezer", label: "Freezer", icon: "🧊" },
  { key: "dispensa", label: "Dispensa", icon: "🏺" },
  { key: "altro", label: "Altro", icon: "📦" },
];

type BatchLike = Pick<StockBatch, "quantity" | "expiryDate">;

function getExpiryStatus(batches: ReadonlyArray<BatchLike>): ExpiryStatus {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return "UNKNOWN";
  const minDays = Math.min(...dates.map((d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)));
  if (minDays <= 0) return "EXPIRED";
  if (minDays <= 5) return "EXPIRING";
  return "FRESH";
}

function expiryDays(batches: ReadonlyArray<BatchLike>): number | null {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  return Math.ceil((Math.min(...dates.map((d) => new Date(d).getTime())) - Date.now()) / 86400000);
}

function totalQuantity(item: { batches: ReadonlyArray<Pick<StockBatch, "quantity">> }): number {
  return item.batches.reduce((sum, b) => sum + b.quantity, 0);
}

interface DisplayBatch extends StockBatch {
  sourceId: string;
  sourceVersion: number;
}

interface GroupedStockItem extends Omit<StockItem, "batches"> {
  aggregateKey: string;
  sources: StockItem[];
  batches: DisplayBatch[];
}

function normalizeGroupPart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stockGroupingKey(item: StockItem): string {
  const product = item.productId
    ? `product:${item.productId}`
    : `name:${normalizeGroupPart(item.name)}|brand:${normalizeGroupPart(item.brand)}`;
  return `${product}|location:${item.location}|unit:${normalizeGroupPart(item.unit)}`;
}

function groupStockItems(items: StockItem[]): GroupedStockItem[] {
  const groups = new Map<string, GroupedStockItem>();

  for (const item of items) {
    if (totalQuantity(item) <= 0) continue;

    const aggregateKey = stockGroupingKey(item);
    const existing = groups.get(aggregateKey);

    if (!existing) {
      groups.set(aggregateKey, {
        ...item,
        aggregateKey,
        sources: [item],
        batches: item.batches.map((batch) => ({
          ...batch,
          sourceId: item.id,
          sourceVersion: item.version,
        })),
      });
      continue;
    }

    existing.sources.push(item);
    existing.batches.push(
      ...item.batches.map((batch) => ({
        ...batch,
        sourceId: item.id,
        sourceVersion: item.version,
      })),
    );
  }

  return [...groups.values()].map((group) => ({
    ...group,
    batches: [...group.batches].sort((a, b) => {
      const da = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      const db = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      return da - db;
    }),
  }));
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
  const [detail, setDetail] = useState<GroupedStockItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Consume modal state
  const [consumeTarget, setConsumeTarget] = useState<GroupedStockItem | null>(null);
  const [consumeQty, setConsumeQty] = useState("");
  const [consumeError, setConsumeError] = useState<string | null>(null);
  const [consumePackage, setConsumePackage] = useState<{ value: number; unit: string; label: string | null } | null>(null);
  const [consumePackageLoading, setConsumePackageLoading] = useState(false);

  const groupedItems = useMemo(() => groupStockItems(stock), [stock]);

  const filtered = useMemo(() => {
    return groupedItems
      .filter((s) => {
        const st = getExpiryStatus(s.batches);
        const totalQty = totalQuantity(s);
        const isLow = s.reorderPoint !== undefined && totalQty <= s.reorderPoint;
        const matchLoc = locFilter === "tutti" || s.location === locFilter;
        const matchStatus =
          statusFilter === "tutti" ||
          st === statusFilter ||
          (statusFilter === "EXPIRING" && isLow);
        const matchSearch = String(s.name ?? "").toLowerCase().includes(search.toLowerCase());
        return matchLoc && matchStatus && matchSearch;
      })
      .sort((a, b) => {
        const order: Record<ExpiryStatus, number> = { EXPIRED: 0, EXPIRING: 1, FRESH: 2, UNKNOWN: 3 };
        return order[getExpiryStatus(a.batches)] - order[getExpiryStatus(b.batches)];
      });
  }, [groupedItems, locFilter, statusFilter, search]);

  const grouped = useMemo(() => {
    const locs = locFilter === "tutti" ? LOCATIONS.map((l) => l.key) : [locFilter as StorageLocation];
    return locs.map((loc) => ({
      loc,
      items: filtered.filter((s) => s.location === loc),
    })).filter((g) => g.items.length > 0);
  }, [filtered, locFilter]);

  const expiredCount = groupedItems.filter((s) => getExpiryStatus(s.batches) === "EXPIRED").length;
  const expiringCount = groupedItems.filter((s) => getExpiryStatus(s.batches) === "EXPIRING").length;

  function handleAddFromModal(item: Omit<StockItem, "id" | "version" | "provenance">) {
    // Keep the storage model lot-level. The derived UI groups equal products immediately,
    // while useInventory persists the new underlying lot as a separate inventory item.
    const newItem: StockItem = {
      ...item,
      id: "si_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      version: 1,
      provenance: "VERIFIED",
    };
    setStock((p) => [...p, newItem]);
    setShowAdd(false);
  }

  async function openConsumeModal(item: GroupedStockItem) {
    setConsumeTarget(item);
    setConsumeQty("");
    setConsumeError(null);
    setConsumePackage(null);
    setConsumePackageLoading(false);

    if (!item.productId) return;

    setConsumePackageLoading(true);
    try {
      const product = await api.getCatalogProduct(item.productId);
      if (product.package.value != null && product.package.value > 0 && product.package.unit && isKnownUnit(product.package.unit)) {
        setConsumePackage({
          value: product.package.value,
          unit: product.package.unit,
          label: product.package.label,
        });
      }
    } catch {
      // Manual partial consumption remains available when Catalog metadata cannot be loaded.
    } finally {
      setConsumePackageLoading(false);
    }
  }

  function closeConsumeModal() {
    setConsumeTarget(null);
    setConsumeQty("");
    setConsumeError(null);
    setConsumePackage(null);
    setConsumePackageLoading(false);
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

    // FEFO across every underlying lot: the UI can present one product while the backend
    // continues to own separate lot rows with independent expiration dates.
    let remaining = qty;
    const consumptionBySource = new Map<string, number>();
    for (const batch of consumeTarget.batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      remaining -= take;
      consumptionBySource.set(batch.sourceId, (consumptionBySource.get(batch.sourceId) ?? 0) + take);
    }

    setStock((prev) =>
      prev.map((item) => {
        const sourceConsume = consumptionBySource.get(item.id);
        if (!sourceConsume) return item;

        let sourceRemaining = sourceConsume;
        const updatedBatches = [...item.batches]
          .sort((a, b) => {
            const da = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
            const db = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
            return da - db;
          })
          .map((batch) => {
            if (sourceRemaining <= 0) return batch;
            const take = Math.min(batch.quantity, sourceRemaining);
            sourceRemaining -= take;
            return { ...batch, quantity: batch.quantity - take };
          });

        const pruned = updatedBatches.filter((batch) => batch.quantity > 0);
        return {
          ...item,
          batches: pruned.length > 0 ? pruned : [{ quantity: 0 }],
          version: item.version + 1,
        };
      }),
    );

    closeConsumeModal();
    setDetail(null);
  }

  function handleWaste(item: GroupedStockItem) {
    const sourceIds = new Set(item.sources.map((source) => source.id));
    setStock((prev) => prev.filter((source) => !sourceIds.has(source.id)));
    setDetail(null);
  }

  const locInfo = (loc: StorageLocation) => LOCATIONS.find((l) => l.key === loc)!;

  // ── Detail panel ─────────────────────────────────────────────────────────────
  if (detail) {
    const st = getExpiryStatus(detail.batches);
    const days = expiryDays(detail.batches);
    const prov = provenanceColor[detail.provenance];
    const totalQty = totalQuantity(detail);
    const datedBatches = detail.batches.filter((batch) => batch.expiryDate);
    const uniqueExpiryDates = [...new Set(datedBatches.map((batch) => batch.expiryDate as string))]
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

              {detail.batches.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: colors.ink }}>Scadenze in dispensa</p>
                      <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                        {detail.batches.length === 1
                          ? "Una sola scorta"
                          : `${detail.batches.length} scorte separate, ordinate dalla scadenza più vicina`}
                      </p>
                    </div>
                    {days !== null && uniqueExpiryDates.length > 0 && (
                      <span className="text-xs font-medium" style={{ color: freshnessColor[st] }}>
                        Prima scadenza: {new Date(uniqueExpiryDates[0]).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${colors.border}` }}>
                    {detail.batches.map((batch, index) => {
                      const batchDays = batch.expiryDate
                        ? Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / 86400000)
                        : null;
                      const batchStatus: ExpiryStatus =
                        batchDays === null ? "UNKNOWN" :
                        batchDays <= 0 ? "EXPIRED" :
                        batchDays <= 5 ? "EXPIRING" : "FRESH";
                      return (
                        <div
                          key={`${batch.sourceId}-${batch.expiryDate ?? "none"}-${index}`}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                          style={{
                            backgroundColor: index === 0 && detail.batches.length > 1 ? colors.cream : colors.white,
                            borderBottom: index < detail.batches.length - 1 ? `1px solid ${colors.border}` : undefined,
                          }}
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                              style={{
                                backgroundColor: freshnessColor[batchStatus],
                                color: colors.white,
                              }}
                            >
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium" style={{ color: colors.ink }}>
                                {batch.expiryDate
                                  ? new Date(batch.expiryDate).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })
                                  : "Nessuna scadenza registrata"}
                              </p>
                              <p className="text-xs" style={{ color: colors.inkMuted }}>
                                {batchDays === null
                                  ? "Data non disponibile"
                                  : batchDays <= 0
                                    ? batchDays === 0 ? "Scade oggi" : `Scaduto da ${Math.abs(batchDays)} giorni`
                                    : batchDays === 1 ? "Scade domani" : `Scade tra ${batchDays} giorni`}
                                {index === 0 && detail.batches.length > 1 ? " · da consumare prima" : ""}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold" style={{ color: colors.ink }}>{batch.quantity} {detail.unit}</p>
                            <p className="text-[10px]" style={{ color: colors.inkMuted }}>quantità</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {detail.calories !== undefined && (
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: colors.inkMuted }}>Valori per 100g</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
                    onClick={() => void openConsumeModal(detail)}
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
            packageInfo={consumePackage}
            packageLoading={consumePackageLoading}
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
  item: GroupedStockItem;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  packageInfo: { value: number; unit: string; label: string | null } | null;
  packageLoading: boolean;
}

function ConsumeQuantityModal({ item, value, error, onChange, onConfirm, onClose, packageInfo, packageLoading }: ConsumeQuantityModalProps) {
  const available = item.batches.reduce((sum, b) => sum + b.quantity, 0);
  const stockUnit = normalizeUnit(item.unit);
  const packageUnit = packageInfo ? normalizeUnit(packageInfo.unit) : null;
  const packageQuantity = packageInfo && packageUnit ? convertQuantity(packageInfo.value, packageUnit, stockUnit) : null;
  const onePackageQuantity = packageQuantity != null && packageQuantity <= available ? packageQuantity : null;
  const halfQuantity = available / 2;
  const packageCount = packageQuantity != null && packageQuantity > 0 ? available / packageQuantity : null;
  const halfPackageCount = packageCount != null ? packageCount / 2 : null;
  const parsedQty = Number(value);
  const isValid = Number.isFinite(parsedQty) && parsedQty > 0 && parsedQty <= available;
  const selectedValue = value.trim() !== "" ? String(Number(value)) : "";

  function choose(quantity: number) {
    onChange(String(Math.round(quantity * 1000) / 1000));
  }

  return (
    <Modal onClose={onClose} variant="dialog" maxWidth="max-w-sm">
      <div className="p-6 space-y-5">
        <div>
          <h3 className="text-lg font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Quanto ne consumi?</h3>
          <p className="text-sm mt-1" style={{ color: colors.inkMuted }}>{item.name}</p>
        </div>

        <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ backgroundColor: colors.cream }}>
          <span className="text-xs" style={{ color: colors.inkMuted }}>Disponibile</span>
          <span className="text-sm font-semibold text-right" style={{ color: colors.ink }}>
            {packageCount != null && Math.abs(packageCount - Math.round(packageCount)) < 0.0001
              ? `${formatQuantity(packageCount)} conf. · ${formatQuantity(available)} ${formatUnit(stockUnit)}`
              : `${formatQuantity(available)} ${formatUnit(stockUnit)}`}
          </span>
        </div>

        {packageLoading && (
          <p className="text-xs text-center" style={{ color: colors.inkMuted }}>Recupero la quantità della confezione…</p>
        )}

        {packageInfo?.label && (
          <p className="text-[11px] text-center" style={{ color: colors.inkMuted }}>
            1 confezione = {packageInfo.label}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-xl p-3 text-left border transition-all"
            style={{ backgroundColor: value === "" ? colors.ink : colors.white, borderColor: colors.border, color: value === "" ? colors.cream : colors.ink }}
          >
            <p className="text-sm font-semibold">Parziale</p>
            <p className="text-[10px] mt-0.5 opacity-75">Inserisci la quantità</p>
          </button>

          <button
            type="button"
            disabled={onePackageQuantity == null || onePackageQuantity <= 0}
            onClick={() => onePackageQuantity != null && choose(onePackageQuantity)}
            className="rounded-xl p-3 text-left border transition-all disabled:opacity-40"
            style={{
              backgroundColor: packageQuantity != null && selectedValue === String(onePackageQuantity) ? colors.ink : colors.white,
              borderColor: colors.border,
              color: packageQuantity != null && selectedValue === String(onePackageQuantity) ? colors.cream : colors.ink,
            }}
          >
            <p className="text-sm font-semibold">1 confezione</p>
            <p className="text-[10px] mt-0.5 opacity-75">
              {packageQuantity != null ? `${formatQuantity(packageQuantity)} ${formatUnit(stockUnit)}` : "Quantità confezione non disponibile"}
            </p>
          </button>

          <button
            type="button"
            disabled={available <= 0}
            onClick={() => choose(halfQuantity)}
            className="rounded-xl p-3 text-left border transition-all disabled:opacity-40"
            style={{
              backgroundColor: selectedValue === String(Math.round(halfQuantity * 1000) / 1000) ? colors.ink : colors.white,
              borderColor: colors.border,
              color: selectedValue === String(Math.round(halfQuantity * 1000) / 1000) ? colors.cream : colors.ink,
            }}
          >
            <p className="text-sm font-semibold">Metà confezioni</p>
            <p className="text-[10px] mt-0.5 opacity-75">
              {packageCount != null
                ? `${formatQuantity(halfPackageCount as number)} conf. · ${formatQuantity(halfQuantity)} ${formatUnit(stockUnit)}`
                : `${formatQuantity(halfQuantity)} ${formatUnit(stockUnit)}`}
            </p>
          </button>

          <button
            type="button"
            disabled={available <= 0}
            onClick={() => choose(available)}
            className="rounded-xl p-3 text-left border transition-all disabled:opacity-40"
            style={{
              backgroundColor: selectedValue === String(available) ? colors.ink : colors.white,
              borderColor: colors.border,
              color: selectedValue === String(available) ? colors.cream : colors.ink,
            }}
          >
            <p className="text-sm font-semibold">Tutto</p>
            <p className="text-[10px] mt-0.5 opacity-75">
              {formatQuantity(available)} {formatUnit(stockUnit)}
              {packageCount != null ? ` · ${formatQuantity(packageCount)} conf.` : ""}
            </p>
          </button>
        </div>

        {value === "" && (
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: colors.inkMuted }}>
              Quantità da consumare ({formatUnit(stockUnit)})
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
          </div>
        )}

        {error && value !== "" && (
          <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>{error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>Annulla</button>
          <button onClick={onConfirm} disabled={!isValid} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40" style={{ backgroundColor: colors.sage, color: colors.white }}>Consuma</button>
        </div>
      </div>
    </Modal>
  );
}
