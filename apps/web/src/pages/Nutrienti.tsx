import { useState, useEffect, useMemo } from "react";
import type { ConsumedItem, StockItem, ConfidenceLabel } from "../types";
import * as api from "../api/endpoints";
import { colors, fonts } from "../tokens";
import { timeAgo } from "../utils/time";
import { Input } from "../components/ui/Input";
import SectionHeading from "../components/ui/SectionHeading";
import { RowList, Row } from "../components/ui/ListRow";

const CONFIDENCE_META: Record<ConfidenceLabel, { label: string; color: string; bg: string }> = {
  CONFIRMED: { label: "confermato", color: colors.sageDark, bg: colors.sageLight },
  ESTIMATED: { label: "stimato", color: colors.amberDark, bg: colors.amberLight },
  UNKNOWN: { label: "non disponibile", color: colors.inkMuted, bg: colors.creamDark },
};

interface Props {
  stock: StockItem[];
  familyId?: string | null;
}

export default function Nutrienti({ stock, familyId }: Props) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.getNutritionSummary>> | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [period, setPeriod] = useState<"oggi" | "settimana">("oggi");
  const [scaleItem, setScaleItem] = useState<StockItem | null>(null);
  const [scaleQty, setScaleQty] = useState(100);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!familyId) { setSummary(null); return; }
    let cancelled = false;
    setLoadingSummary(true);
    api.getNutritionSummary(familyId, period === "oggi" ? "today" : "week")
      .then(v => { if (!cancelled) setSummary(v); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoadingSummary(false); });
    return () => { cancelled = true; };
  }, [familyId, period]);

  const consumed: ConsumedItem[] = useMemo(() => (summary?.items ?? []).map(c => ({
    id: c.movementId, name: c.productName, quantity:c.quantity, unit:c.unit,
    nutrients:{...c.nutrients, confidence:c.confidence}, at:c.occurredAt
  })), [summary]);

  const totals = summary?.totals ?? { calories:0, protein:0, carbs:0, fat:0, fiber:0 };

  const filteredStock = useMemo(() => {
    if (!search) return [];
    return stock.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) && s.calories !== undefined).slice(0, 6);
  }, [stock, search]);

  const scaledValues = useMemo(() => {
    if (!scaleItem || scaleItem.calories === undefined) return null;
    const factor = scaleQty / 100;
    return {
      calories: Math.round((scaleItem.calories ?? 0) * factor),
      protein: Math.round((scaleItem.protein ?? 0) * factor * 10) / 10,
      carbs: Math.round((scaleItem.carbs ?? 0) * factor * 10) / 10,
      fat: Math.round((scaleItem.fat ?? 0) * factor * 10) / 10,
      fiber: Math.round((scaleItem.fiber ?? 0) * factor * 10) / 10,
    };
  }, [scaleItem, scaleQty]);

  const macroTotal = totals.protein * 4 + totals.carbs * 4 + totals.fat * 9;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Nutrienti</h2>
        <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
          {(["oggi", "settimana"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-4 py-2 text-xs font-medium transition-all"
              style={{ backgroundColor: period === p ? colors.ink : colors.white, color: period === p ? colors.cream : colors.inkMuted }}
              aria-pressed={period === p}
            >
              {p === "oggi" ? "Oggi" : "Settimana"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Calorie", value: Math.round(totals.calories), unit: "kcal", color: colors.terracotta, bg: colors.terracottaLight },
          { label: "Proteine", value: Math.round(totals.protein), unit: "g", color: colors.sage, bg: colors.sageLight },
          { label: "Carboidrati", value: Math.round(totals.carbs), unit: "g", color: colors.expiring, bg: colors.amberLight },
          { label: "Grassi", value: Math.round(totals.fat), unit: "g", color: colors.inkMuted, bg: colors.creamDark },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-5" style={{ backgroundColor: s.bg }}>
            <p className="text-xs font-medium" style={{ color: s.color }}>{s.label}</p>
            <p className="text-3xl font-light mt-1" style={{ fontFamily: fonts.display, color: colors.ink }}>{s.value}</p>
            <p className="text-[10px] mt-0.5" style={{ color: colors.inkMuted }}>{s.unit} totali {period === "oggi" ? "oggi" : "questa settimana"}</p>
          </div>
        ))}
      </div>

      {/* Macro distribution */}
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
        <SectionHeading>Distribuzione macronutrienti</SectionHeading>
        {[
          { label: "Proteine", value: totals.protein, kcal: totals.protein * 4, color: colors.sage },
          { label: "Carboidrati", value: totals.carbs, kcal: totals.carbs * 4, color: colors.expiring },
          { label: "Grassi", value: totals.fat, kcal: totals.fat * 9, color: colors.terracotta },
        ].map((m) => {
          const pct = macroTotal > 0 ? Math.round((m.kcal / macroTotal) * 100) : 0;
          return (
            <div key={m.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span style={{ color: colors.ink, fontWeight: 500 }}>{m.label}</span>
                <span style={{ color: colors.inkMuted }}>{Math.round(m.value)}g · {pct}%</span>
              </div>
              <div className="h-2 rounded-full" style={{ backgroundColor: colors.creamDark }}>
                <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: m.color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Quantity scaler */}
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
        <SectionHeading>Calcolatore per quantità</SectionHeading>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca un prodotto in dispensa…"
          aria-label="Cerca prodotto"
        />
        {filteredStock.length > 0 && !scaleItem && (
          <RowList>
            {filteredStock.map((item, i) => (
              <Row key={item.id} index={i} last={i === filteredStock.length - 1}>
                <button
                  onClick={() => { setScaleItem(item); setScaleQty(100); setSearch(""); }}
                  className="flex-1 flex items-center justify-between text-left text-sm"
                  style={{ color: colors.ink }}
                >
                  {item.name}
                  <span style={{ color: colors.inkMuted, fontSize: "0.7rem" }}>{item.calories} kcal/100g</span>
                </button>
              </Row>
            ))}
          </RowList>
        )}
        {scaleItem && scaledValues && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm" style={{ color: colors.ink }}>{scaleItem.name}</p>
              <button onClick={() => { setScaleItem(null); setScaleQty(100); }} className="text-xs" style={{ color: colors.inkMuted }}>Cambia</button>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium flex justify-between" style={{ color: colors.inkMuted }}>
                Quantità <span style={{ color: colors.ink }}>{scaleQty} {scaleItem.unit}</span>
              </label>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={scaleQty}
                onChange={(e) => setScaleQty(Number(e.target.value))}
                className="w-full accent-[#c4623a]"
              />
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "kcal", value: scaledValues.calories },
                { label: "prot.", value: scaledValues.protein },
                { label: "carb.", value: scaledValues.carbs },
                { label: "grassi", value: scaledValues.fat },
                { label: "fibre", value: scaledValues.fiber },
              ].map((n) => (
                <div key={n.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: colors.cream }}>
                  <p className="text-base font-semibold" style={{ color: colors.ink }}>{n.value}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: colors.inkMuted }}>{n.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent consumption */}
      <div className="space-y-3">
        <SectionHeading>Consumati di recente</SectionHeading>
        {consumed.length === 0 ? (
          <div className="rounded-2xl p-6 text-center text-sm" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
            Nessun consumo registrato {period === "oggi" ? "oggi" : "questa settimana"}.
          </div>
        ) : (
          <RowList>
            {consumed.map((item, idx) => {
              const cs = CONFIDENCE_META[item.nutrients.confidence];
              return (
                <Row key={item.id} index={idx} last={idx === consumed.length - 1}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" style={{ color: colors.ink }}>{item.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: cs.bg, color: cs.color }}>{cs.label}</span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      {item.quantity} {item.unit} · {timeAgo(item.at)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold" style={{ color: colors.terracotta }}>{item.nutrients.calories}</p>
                    <p className="text-[10px]" style={{ color: colors.inkMuted }}>kcal</p>
                  </div>
                </Row>
              );
            })}
          </RowList>
        )}
        <p className="text-[10px] text-center" style={{ color: colors.inkMuted }}>
          I valori nutrizionali sono indicativi e non costituiscono consulenza medica o dietetica.
        </p>
      </div>
    </div>
  );
}
