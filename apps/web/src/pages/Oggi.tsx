import { useMemo } from "react";
import type { StockItem, ShoppingList } from "../types";
import { colors, fonts } from "../tokens";
import { expiryDays } from "../utils/expiry";
import { computeRecipeMatches } from "../mockData";

interface Props {
  stock: StockItem[];
  shopping: ShoppingList;
  currentUserName: string;
  onNavigate: (tab: string) => void;
}

export default function Oggi({ stock, shopping, currentUserName, onNavigate }: Props) {
  const expired = useMemo(() => stock.filter((s) => { const d = expiryDays(s.batches); return d !== null && d <= 0; }), [stock]);
  const expiring = useMemo(() => stock.filter((s) => { const d = expiryDays(s.batches); return d !== null && d > 0 && d <= 5; }), [stock]);
  const lowStock = useMemo(() => stock.filter((s) => s.reorderPoint !== undefined && s.batches.reduce((a, b) => a + b.quantity, 0) <= s.reorderPoint), [stock]);
  const topRecipe = useMemo(() => computeRecipeMatches(stock)[0], [stock]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  const firstName = currentUserName.split(" ")[0];

  const urgentCount = expired.length + expiring.length + lowStock.length;

  let heroText = "";
  let heroColor: string = colors.sage;
  if (expired.length > 0) {
    heroText = `${expired.length} prodott${expired.length > 1 ? "i" : "o"} scadut${expired.length > 1 ? "i" : "o"} — da rivedere subito`;
    heroColor = colors.terracotta;
  } else if (expiring.length > 0) {
    heroText = `${expiring.length} prodott${expiring.length > 1 ? "i" : "o"} scad${expiring.length > 1 ? "ono" : "e"} nei prossimi 5 giorni`;
    heroColor = colors.expiring;
  } else if (lowStock.length > 0) {
    heroText = `${lowStock.length} articol${lowStock.length > 1 ? "i" : "o"} sotto la soglia di riordino`;
    heroColor = colors.inkMuted;
  } else {
    heroText = "Tutto sotto controllo. La dispensa è in ordine.";
    heroColor = colors.sage;
  }

  return (
    <div className="space-y-8">
      {/* Greeting + contextual hero */}
      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: colors.inkMuted }}>{greeting}, {firstName}</p>
        <h1 className="text-2xl font-light leading-snug" style={{ fontFamily: fonts.display, color: heroColor }}>
          {heroText}
        </h1>
      </div>

      {/* 3 stat numbers */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Scaduti", count: expired.length, color: colors.terracotta, bg: colors.terracottaLight, tab: "dispensa" },
          { label: "In scadenza", count: expiring.length, color: colors.expiring, bg: colors.expiringBg, tab: "dispensa" },
          { label: "Scorte basse", count: lowStock.length, color: colors.inkMuted, bg: colors.creamDark, tab: "spesa" },
        ].map((s) => (
          <button
            key={s.label}
            onClick={() => onNavigate(s.tab)}
            className="rounded-2xl p-4 text-left transition-all hover:opacity-80"
            style={{ backgroundColor: s.bg }}
            aria-label={`${s.count} ${s.label} — vai a ${s.tab}`}
          >
            <p className="text-3xl font-light" style={{ fontFamily: fonts.display, color: s.color }}>{s.count}</p>
            <p className="text-xs font-medium mt-1" style={{ color: s.color }}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.inkMuted }}>Azioni rapide</p>
        <div className="space-y-2">
          {([
            expired.length > 0 && {
              label: `Rivedi ${expired.length} prodott${expired.length > 1 ? "i" : "o"} scadut${expired.length > 1 ? "i" : "o"}`,
              tab: "dispensa", priority: true, icon: "⚠️",
            },
            expiring.length > 0 && {
              label: "Rivedi le scadenze ravvicinate",
              tab: "dispensa", priority: false, icon: "📅",
            },
            lowStock.length > 0 && {
              label: "Vai alla lista della spesa",
              tab: "spesa", priority: false, icon: "🛒",
            },
            { label: "Aggiungi un prodotto", tab: "dispensa", priority: false, icon: "+" },
          ] as (false | { label: string; tab: string; priority: boolean; icon: string })[])
            .filter(Boolean)
            .map((action) => {
              if (!action) return null;
              return (
                <button
                  key={action.label}
                  onClick={() => onNavigate(action.tab)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all hover:opacity-80"
                  style={{
                    backgroundColor: action.priority ? colors.terracottaLight : colors.white,
                    border: `1px solid ${action.priority ? colors.terracottaMid : colors.border}`,
                  }}
                >
                  <span className="text-base w-6 text-center">{action.icon}</span>
                  <span className="text-sm font-medium flex-1" style={{ color: action.priority ? colors.terracotta : colors.ink }}>
                    {action.label}
                  </span>
                  <span className="text-xs" style={{ color: colors.border }}>→</span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Recipe of the day */}
      {topRecipe && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.inkMuted }}>Suggerimento del giorno</p>
          <button
            onClick={() => onNavigate("ricette")}
            className="w-full rounded-2xl overflow-hidden text-left transition-all hover:opacity-90"
            style={{ border: `1px solid ${colors.border}` }}
            aria-label={`Vedi ricetta: ${topRecipe.recipe.title}`}
          >
            <div className="relative h-36" style={{ backgroundColor: colors.border }}>
              <img
                src={`https://images.unsplash.com/${topRecipe.recipe.image}?w=700&h=260&fit=crop&auto=format`}
                alt={topRecipe.recipe.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(26,21,16,0.65) 0%, transparent 60%)" }} />
              <div className="absolute bottom-3 left-4 right-4">
                <p className="text-white font-light text-lg" style={{ fontFamily: fonts.display }}>
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

      {/* All OK empty state */}
      {urgentCount === 0 && (
        <div className="rounded-2xl p-6 text-center space-y-2" style={{ backgroundColor: colors.sageLight, border: `1px solid #c4d9c6` }}>
          <p className="text-2xl">✓</p>
          <p className="font-semibold text-sm" style={{ color: colors.sageDark }}>La dispensa è in ordine</p>
          <p className="text-xs" style={{ color: colors.sage }}>Nessuna urgenza per oggi.</p>
          <button
            onClick={() => onNavigate("dispensa")}
            className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold"
            style={{ backgroundColor: colors.sage, color: colors.white }}
          >
            Aggiungi un prodotto
          </button>
        </div>
      )}

      {/* Shopping list summary */}
      <div
        className="rounded-2xl p-4 flex items-center justify-between gap-3"
        style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}
      >
        <div>
          <p className="font-semibold text-sm" style={{ color: colors.ink }}>Lista spesa</p>
          <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
            {shopping.items.filter((i) => i.state === "ACCEPTED").length} articoli confermati
            {shopping.lastEditedBy && ` · ${shopping.lastEditedBy.split(" ")[0]}`}
          </p>
        </div>
        <button
          onClick={() => onNavigate("spesa")}
          className="px-3 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ backgroundColor: colors.terracotta, color: colors.white }}
        >
          Vai alla spesa
        </button>
      </div>
    </div>
  );
}
