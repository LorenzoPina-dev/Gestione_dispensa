import { useState, useMemo } from "react";
import type { RecipeMatch } from "../types";
import type { StockItem, ShoppingList } from "../types";
import { computeRecipeMatches } from "../mockData";

interface Props {
  stock: StockItem[];
  setList: React.Dispatch<React.SetStateAction<ShoppingList>>;
}

export default function Ricette({ stock, setList }: Props) {
  const [onlyFeasible, setOnlyFeasible] = useState(false);
  const [detail, setDetail] = useState<RecipeMatch | null>(null);
  const [addedMissing, setAddedMissing] = useState<Set<string>>(new Set());
  const [consentGiven, setConsentGiven] = useState(false);
  const [showConsentBanner, setShowConsentBanner] = useState(true);

  const matches = useMemo(() => {
    const all = computeRecipeMatches(stock);
    return onlyFeasible ? all.filter((m) => m.score === 1) : all;
  }, [stock, onlyFeasible]);

  function addMissingToCart(match: RecipeMatch) {
    const toAdd = match.missingIngredients;
    setList((l) => {
      const newItems = toAdd.map((name, i) => ({
        id: "sli_recipe_" + Date.now() + i,
        displayName: name,
        quantity: 1,
        unit: "pz",
        state: "SUGGESTED" as const,
        sourceType: "RECIPE" as const,
        sourceRef: match.recipe.id,
        version: 1,
        addedBy: "Ricette",
        addedAt: new Date().toISOString(),
      }));
      return { ...l, items: [...l.items, ...newItems], version: l.version + 1, lastEditedAt: new Date().toISOString(), lastEditedBy: "Giulia Ferretti" };
    });
    setAddedMissing((s) => {
      const n = new Set(s);
      n.add(match.recipe.id);
      return n;
    });
  }

  const qualityBadge: Record<string, { label: string; color: string; bg: string }> = {
    VERIFIED: { label: "ricetta verificata", color: "#3d6641", bg: "#dceadd" },
    IMPORTED: { label: "fonte esterna", color: "#92400e", bg: "#faecd4" },
    ESTIMATED: { label: "dati stimati", color: "#6b5e4e", bg: "#ede6d6" },
    UNKNOWN: { label: "fonte ignota", color: "#6b5e4e", bg: "#ede6d6" },
  };

  if (detail) {
    const qb = qualityBadge[detail.recipe.quality];
    const pct = Math.round(detail.score * 100);
    const alreadyAdded = addedMissing.has(detail.recipe.id);
    return (
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm font-medium hover:opacity-60 transition-opacity" style={{ color: "#6b5e4e" }}>
          ← Tutte le ricette
        </button>
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
          <div className="relative h-52" style={{ backgroundColor: "#d8cfc0" }}>
            <img
              src={`https://images.unsplash.com/${detail.recipe.image}?w=800&h=400&fit=crop&auto=format`}
              alt={detail.recipe.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(26,21,16,0.65) 0%, transparent 55%)" }} />
            <div className="absolute bottom-4 left-5 right-5">
              <h2 className="text-2xl font-light text-white" style={{ fontFamily: "var(--font-display)" }}>{detail.recipe.title}</h2>
              <div className="flex gap-3 mt-1 text-white/70 text-xs">
                <span>⏱ {detail.recipe.time} min</span>
                <span>👥 {detail.recipe.servings} porzioni</span>
                <span>📊 {detail.recipe.difficulty}</span>
                <span>🔥 {detail.recipe.caloriesPerServing} kcal/porz.</span>
              </div>
            </div>
          </div>
          <div className="p-5 space-y-5" style={{ backgroundColor: "#fff" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-2 flex-wrap">
                {detail.recipe.tags.map((t) => (
                  <span key={t} className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>{t}</span>
                ))}
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: qb.bg, color: qb.color }}>{qb.label}</span>
            </div>

            {/* Compatibility bar */}
            <div className="rounded-xl p-3" style={{ backgroundColor: "#f5f0e8" }}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold" style={{ color: "#1a1510" }}>{detail.matchedIngredients.length}/{detail.recipe.ingredients.length} ingredienti in dispensa</span>
                <span className="text-sm font-light" style={{ fontFamily: "var(--font-display)", color: pct === 100 ? "#5a7a5e" : "#c4623a" }}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ backgroundColor: "#d8cfc0" }}>
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? "#5a7a5e" : pct >= 60 ? "#d4943a" : "#c4623a" }} />
              </div>
            </div>

            {/* Ingredients */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Ingredienti</p>
              <div className="space-y-1">
                {detail.recipe.ingredients.map((ing) => {
                  const inPantry = detail.matchedIngredients.includes(ing.name);
                  return (
                    <div key={ing.name} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "#f0ebe0" }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: inPantry ? "#5a7a5e" : "#c4623a" }}>{inPantry ? "✓" : "✗"}</span>
                        <span className="text-sm" style={{ color: inPantry ? "#1a1510" : "#c4623a" }}>{ing.name}</span>
                        {ing.allergens.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#faecd4", color: "#92400e" }}>
                            {ing.allergens.join(", ")}
                          </span>
                        )}
                      </div>
                      <span className="text-xs" style={{ color: "#6b5e4e" }}>{ing.amount} {ing.unit}</span>
                    </div>
                  );
                })}
              </div>
              {detail.missingIngredients.length > 0 && (
                <button
                  onClick={() => addMissingToCart(detail)}
                  disabled={alreadyAdded}
                  className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ backgroundColor: alreadyAdded ? "#dceadd" : "#c4623a", color: alreadyAdded ? "#3d6641" : "#fff" }}
                >
                  {alreadyAdded ? "Ingredienti mancanti aggiunti alla spesa ✓" : `Aggiungi ${detail.missingIngredients.length} ingredienti mancanti alla spesa`}
                </button>
              )}
            </div>

            {/* Steps */}
            <div>
              <p className="text-xs font-semibold mb-3" style={{ color: "#6b5e4e" }}>Preparazione</p>
              <ol className="space-y-3">
                {detail.recipe.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm" style={{ color: "#3d3028" }}>
                    <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: "#faecd4", color: "#c4623a" }}>
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>Ricette</h2>
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#6b5e4e" }}>
          <div
            onClick={() => setOnlyFeasible((v) => !v)}
            className="w-10 h-5 rounded-full relative transition-all cursor-pointer"
            style={{ backgroundColor: onlyFeasible ? "#c4623a" : "#d8cfc0" }}
          >
            <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all" style={{ left: onlyFeasible ? "calc(100% - 18px)" : "2px", backgroundColor: "#fff" }} />
          </div>
          Solo realizzabili
        </label>
      </div>

      {/* Personalisation consent */}
      {showConsentBanner && !consentGiven && (
        <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: "#faecd4", border: "1px solid #f0ddd5" }}>
          <p className="text-sm font-medium" style={{ color: "#1a1510" }}>Ricette personalizzate</p>
          <p className="text-xs leading-relaxed" style={{ color: "#6b5e4e" }}>
            Attivando la personalizzazione, le ricette verranno suggerite in base alle abitudini della famiglia. Puoi revocare il consenso in qualsiasi momento dalla sezione Famiglia → Privacy.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConsentGiven(true)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
              Attiva personalizzazione
            </button>
            <button onClick={() => setShowConsentBanner(false)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ backgroundColor: "#ede6d6", color: "#6b5e4e" }}>
              Non ora
            </button>
          </div>
        </div>
      )}
      {consentGiven && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>
          Personalizzazione attiva · revoca in Famiglia → Privacy
        </div>
      )}

      {/* Recipe cards */}
      {matches.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: "#ede6d6" }}>
          <p className="font-medium text-sm" style={{ color: "#6b5e4e" }}>Nessuna ricetta realizzabile</p>
          <p className="text-xs mt-1" style={{ color: "#6b5e4e" }}>Togli il filtro "solo realizzabili" o aggiungi più ingredienti alla dispensa.</p>
          <button onClick={() => setOnlyFeasible(false)} className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold" style={{ backgroundColor: "#c4623a", color: "#fff" }}>
            Mostra tutte
          </button>
        </div>
      )}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {matches.map((match) => {
          const pct = Math.round(match.score * 100);
          return (
            <button
              key={match.recipe.id}
              onClick={() => setDetail(match)}
              className="rounded-2xl overflow-hidden text-left transition-all hover:scale-[1.01]"
              style={{ border: "1px solid #d8cfc0", backgroundColor: "#fff" }}
            >
              <div className="relative h-40" style={{ backgroundColor: "#d8cfc0" }}>
                <img
                  src={`https://images.unsplash.com/${match.recipe.image}?w=600&h=280&fit=crop&auto=format`}
                  alt={match.recipe.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(26,21,16,0.5) 0%, transparent 55%)" }} />
                <div
                  className="absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: pct === 100 ? "#dceadd" : pct >= 60 ? "#faecd4" : "#f0ddd5",
                    color: pct === 100 ? "#3d6641" : pct >= 60 ? "#92400e" : "#c4623a",
                  }}
                >
                  {match.matchedIngredients.length}/{match.recipe.ingredients.length} ingredienti
                </div>
              </div>
              <div className="p-4 space-y-2">
                <h3 className="font-semibold text-sm" style={{ color: "#1a1510" }}>{match.recipe.title}</h3>
                <div className="flex gap-3 text-xs" style={{ color: "#6b5e4e" }}>
                  <span>⏱ {match.recipe.time} min</span>
                  <span>📊 {match.recipe.difficulty}</span>
                  <span>🔥 {match.recipe.caloriesPerServing} kcal</span>
                </div>
                <div className="h-1 rounded-full" style={{ backgroundColor: "#ede6d6" }}>
                  <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? "#5a7a5e" : pct >= 60 ? "#d4943a" : "#c4623a" }} />
                </div>
                {match.missingIngredients.length > 0 && (
                  <p className="text-[10px]" style={{ color: "#c4623a" }}>Mancano: {match.missingIngredients.join(", ")}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
