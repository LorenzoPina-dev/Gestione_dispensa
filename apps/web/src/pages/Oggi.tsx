import { useMemo } from "react";
import type { StockItem, ShoppingList } from "../types";
import { computeRecipeMatches } from "../mockData";

function expiryDays(batches: StockItem["batches"]): number | null {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  const nearest = Math.min(...dates.map((d) => new Date(d).getTime()));
  return Math.ceil((nearest - Date.now()) / 86400000);
}

interface Props {
  stock: StockItem[];
  shopping: ShoppingList;
  onNavigate: (tab: string) => void;
}

export default function Oggi({ stock, shopping, onNavigate }: Props) {
  const expired = useMemo(() => stock.filter((s) => { const d = expiryDays(s.batches); return d !== null && d <= 0; }), [stock]);
  const expiring = useMemo(() => stock.filter((s) => { const d = expiryDays(s.batches); return d !== null && d > 0 && d <= 5; }), [stock]);
  const lowStock = useMemo(() => stock.filter((s) => s.reorderPoint !== undefined && s.batches.reduce((a, b) => a + b.quantity, 0) <= s.reorderPoint), [stock]);
  const recipeMatches = useMemo(() => computeRecipeMatches(stock), [stock]);
  const topRecipe = recipeMatches[0];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";

  const urgentCount = expired.length + expiring.length + lowStock.length;

  let heroText = "";
  let heroColor = "";
  if (expired.length > 0) {
    heroText = `${expired.length} prodott${expired.length > 1 ? "i" : "o"} scadut${expired.length > 1 ? "i" : "o"} — da rivedere subito`;
    heroColor = "#c4623a";
  } else if (expiring.length > 0) {
    heroText = `${expiring.length} prodott${expiring.length > 1 ? "i" : "o"} scad${expiring.length > 1 ? "ono" : "e"} nei prossimi 5 giorni`;
    heroColor = "#d4943a";
  } else if (lowStock.length > 0) {
    heroText = `${lowStock.length} articol${lowStock.length > 1 ? "i" : "o"} sotto la soglia di riordino`;
    heroColor = "#6b5e4e";
  } else {
    heroText = "Tutto sotto controllo. La dispensa è in ordine.";
    heroColor = "#5a7a5e";
  }

  return (
    <div className="space-y-8">
      {/* Greeting + hero */}
      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: "#6b5e4e" }}>{greeting}, Giulia</p>
        <h1 className="text-2xl font-light leading-snug" style={{ fontFamily: "var(--font-display)", color: heroColor }}>
          {heroText}
        </h1>
      </div>

      {/* 3 stat numbers */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Scaduti", count: expired.length, color: "#c4623a", bg: "#f0ddd5", action: "dispensa" },
          { label: "In scadenza", count: expiring.length, color: "#d4943a", bg: "#faecd4", action: "dispensa" },
          { label: "Scorte basse", count: lowStock.length, color: "#6b5e4e", bg: "#ede6d6", action: "spesa" },
        ].map((s) => (
          <button
            key={s.label}
            onClick={() => onNavigate(s.action)}
            className="rounded-2xl p-4 text-left transition-all hover:opacity-80"
            style={{ backgroundColor: s.bg }}
          >
            <p className="text-3xl font-light" style={{ fontFamily: "var(--font-display)", color: s.color }}>{s.count}</p>
            <p className="text-xs font-medium mt-1" style={{ color: s.color }}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>Azioni rapide</p>
        <div className="space-y-2">
          {[
            expired.length > 0 && { label: `Rivedi ${expired.length} prodott${expired.length > 1 ? "i" : "o"} scadut${expired.length > 1 ? "i" : "o"}`, tab: "dispensa", priority: true, icon: "⚠️" },
            expiring.length > 0 && { label: `Rivedi le scadenze ravvicinate`, tab: "dispensa", priority: false, icon: "📅" },
            lowStock.length > 0 && { label: "Vai alla lista della spesa", tab: "spesa", priority: false, icon: "🛒" },
            { label: "Aggiungi un prodotto", tab: "dispensa", priority: false, icon: "+" },
          ].filter(Boolean).map((action: { label: string; tab: string; priority: boolean; icon: string } | false) => {
            if (!action) return null;
            return (
              <button
                key={action.label}
                onClick={() => onNavigate(action.tab)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all hover:opacity-80"
                style={{
                  backgroundColor: action.priority ? "#f0ddd5" : "#fff",
                  border: `1px solid ${action.priority ? "#f0ddd5" : "#d8cfc0"}`,
                }}
              >
                <span className="text-base">{action.icon}</span>
                <span className="text-sm font-medium" style={{ color: action.priority ? "#c4623a" : "#1a1510" }}>
                  {action.label}
                </span>
                <span className="ml-auto text-xs" style={{ color: "#6b5e4e" }}>→</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recipe suggestion */}
      {topRecipe && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b5e4e" }}>Suggerimento del giorno</p>
          <button
            onClick={() => onNavigate("ricette")}
            className="w-full rounded-2xl overflow-hidden text-left transition-all hover:opacity-90"
            style={{ border: "1px solid #d8cfc0" }}
          >
            <div className="relative h-36" style={{ backgroundColor: "#d8cfc0" }}>
              <img
                src={`https://images.unsplash.com/${topRecipe.recipe.image}?w=700&h=260&fit=crop&auto=format`}
                alt={topRecipe.recipe.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(26,21,16,0.65) 0%, transparent 60%)" }} />
              <div className="absolute bottom-3 left-4 right-4">
                <p className="text-white font-light text-lg" style={{ fontFamily: "var(--font-display)" }}>
                  {topRecipe.recipe.title}
                </p>
                <p className="text-white/70 text-xs mt-0.5">
                  {topRecipe.matchedIngredients.length}/{topRecipe.recipe.ingredients.length} ingredienti in dispensa · {topRecipe.recipe.time} min
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Empty state */}
      {urgentCount === 0 && (
        <div
          className="rounded-2xl p-6 text-center space-y-2"
          style={{ backgroundColor: "#dceadd", border: "1px solid #c4d9c6" }}
        >
          <p className="text-2xl">✓</p>
          <p className="font-medium text-sm" style={{ color: "#3d6641" }}>La dispensa è in ordine</p>
          <p className="text-xs" style={{ color: "#5a7a5e" }}>Nessuna urgenza per oggi. Aggiungi un prodotto se sei tornato dalla spesa.</p>
          <button
            onClick={() => onNavigate("dispensa")}
            className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold"
            style={{ backgroundColor: "#5a7a5e", color: "#fff" }}
          >
            Aggiungi un prodotto
          </button>
        </div>
      )}

      {/* Shopping summary */}
      <div
        className="rounded-2xl p-4 flex items-center justify-between gap-3"
        style={{ backgroundColor: "#fff", border: "1px solid #d8cfc0" }}
      >
        <div>
          <p className="font-medium text-sm" style={{ color: "#1a1510" }}>Lista spesa</p>
          <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>
            {shopping.items.filter((i) => i.state === "ACCEPTED").length} articoli · modificata da {shopping.lastEditedBy?.split(" ")[0]}
          </p>
        </div>
        <button
          onClick={() => onNavigate("spesa")}
          className="px-3 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ backgroundColor: "#c4623a", color: "#fff" }}
        >
          Vai alla spesa
        </button>
      </div>
    </div>
  );
}
