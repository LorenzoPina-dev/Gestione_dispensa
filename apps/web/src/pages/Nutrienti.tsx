import { useState, useMemo } from "react";
import type { ConsumedItem, StockItem, ConfidenceLabel } from "../types";
import { recentConsumed } from "../mockData";

const confidenceStyle: Record<ConfidenceLabel, { label: string; color: string; bg: string }> = {
  CONFIRMED: { label: "confermato", color: "#3d6641", bg: "#dceadd" },
  ESTIMATED: { label: "stimato", color: "#92400e", bg: "#faecd4" },
  UNKNOWN: { label: "non disponibile", color: "#6b5e4e", bg: "#ede6d6" },
};

function timeLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "meno di un'ora fa";
  if (hrs < 24) return `${hrs}h fa`;
  return `${Math.floor(hrs / 24)}g fa`;
}

interface Props {
  stock: StockItem[];
}

export default function Nutrienti({ stock }: Props) {
  const [period, setPeriod] = useState<"oggi" | "settimana">("oggi");
  const [scaleItem, setScaleItem] = useState<StockItem | null>(null);
  const [scaleQty, setScaleQty] = useState(100);
  const [search, setSearch] = useState("");

  const consumed: ConsumedItem[] = recentConsumed;

  const totals = useMemo(() => {
    return consumed.reduce(
      (acc, c) => ({
        calories: acc.calories + c.nutrients.calories,
        protein: acc.protein + c.nutrients.protein,
        carbs: acc.carbs + c.nutrients.carbs,
        fat: acc.fat + c.nutrients.fat,
        fiber: acc.fiber + c.nutrients.fiber,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );
  }, [consumed]);

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
        <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Nutrienti</h2>
        <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
          {(["oggi", "settimana"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-4 py-2 text-xs font-medium transition-all"
              style={{ backgroundColor: period === p ? "#1a1510" : "#fff", color: period === p ? "#f5f0e8" : "#6b5e4e" }}
            >
              {p === "oggi" ? "Oggi" : "Settimana"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Calorie", value: Math.round(totals.calories), unit: "kcal", color: "#c4623a", bg: "#f0ddd5" },
          { label: "Proteine", value: Math.round(totals.protein), unit: "g", color: "#5a7a5e", bg: "#dceadd" },
          { label: "Carboidrati", value: Math.round(totals.carbs), unit: "g", color: "#d4943a", bg: "#faecd4" },
          { label: "Grassi", value: Math.round(totals.fat), unit: "g", color: "#6b5e4e", bg: "#ede6d6" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-5" style={{ backgroundColor: s.bg }}>
            <p className="text-xs font-medium" style={{ color: s.color }}>{s.label}</p>
            <p className="text-3xl font-light mt-1" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>{s.value}</p>
            <p className="text-[10px] mt-0.5" style={{ color: "#6b5e4e" }}>{s.unit} totali {period === "oggi" ? "oggi" : "questa settimana"}</p>
          </div>
        ))}
      </div>

      {/* Macro distribution */}
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
        <p className="text-xs font-semibold" style={{ color: "#6b5e4e" }}>Distribuzione macronutrienti</p>
        {[
          { label: "Proteine", value: totals.protein, kcal: totals.protein * 4, color: "#5a7a5e" },
          { label: "Carboidrati", value: totals.carbs, kcal: totals.carbs * 4, color: "#d4943a" },
          { label: "Grassi", value: totals.fat, kcal: totals.fat * 9, color: "#c4623a" },
        ].map((m) => {
          const pct = macroTotal > 0 ? Math.round((m.kcal / macroTotal) * 100) : 0;
          return (
            <div key={m.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span style={{ color: "#1a1510", fontWeight: 500 }}>{m.label}</span>
                <span style={{ color: "#6b5e4e" }}>{Math.round(m.value)}g · {pct}%</span>
              </div>
              <div className="h-2 rounded-full" style={{ backgroundColor: "#ede6d6" }}>
                <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: m.color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Quantity scaler */}
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}>
        <p className="text-xs font-semibold" style={{ color: "#6b5e4e" }}>Calcolatore per quantità</p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca un prodotto in dispensa…"
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ backgroundColor: "#f5f0e8", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#c4623a")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#d8cfc0")}
        />
        {filteredStock.length > 0 && !scaleItem && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
            {filteredStock.map((item, i) => (
              <button
                key={item.id}
                onClick={() => { setScaleItem(item); setScaleQty(100); setSearch(""); }}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-opacity-50"
                style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#faf7f2", borderBottom: i < filteredStock.length - 1 ? "1px solid #f0ebe0" : "none", color: "#1a1510" }}
              >
                {item.name}
                <span style={{ color: "#6b5e4e", fontSize: "0.7rem" }}>{item.calories} kcal/100g</span>
              </button>
            ))}
          </div>
        )}
        {scaleItem && scaledValues && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm" style={{ color: "#1a1510" }}>{scaleItem.name}</p>
              <button onClick={() => { setScaleItem(null); setScaleQty(100); }} className="text-xs" style={{ color: "#6b5e4e" }}>Cambia</button>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium flex justify-between" style={{ color: "#6b5e4e" }}>
                Quantità <span style={{ color: "#1a1510" }}>{scaleQty} {scaleItem.unit}</span>
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
                <div key={n.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: "#f5f0e8" }}>
                  <p className="text-base font-semibold" style={{ color: "#1a1510" }}>{n.value}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: "#6b5e4e" }}>{n.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent consumption */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>Consumati di recente</p>
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
          {consumed.map((item, idx) => {
            const cs = confidenceStyle[item.nutrients.confidence];
            return (
              <div
                key={item.id}
                className="flex items-center gap-4 px-4 py-3"
                style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#faf7f2", borderBottom: idx < consumed.length - 1 ? "1px solid #f0ebe0" : "none" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium" style={{ color: "#1a1510" }}>{item.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: cs.bg, color: cs.color }}>{cs.label}</span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>
                    {item.quantity} {item.unit} · {timeLabel(item.at)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold" style={{ color: "#c4623a" }}>{item.nutrients.calories}</p>
                  <p className="text-[10px]" style={{ color: "#6b5e4e" }}>kcal</p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-center" style={{ color: "#6b5e4e" }}>
          I valori nutrizionali sono indicativi e non costituiscono consulenza medica o dietetica.
        </p>
      </div>
    </div>
  );
}
