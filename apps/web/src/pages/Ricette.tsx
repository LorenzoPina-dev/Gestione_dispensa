import { useState, useMemo } from "react";
import type { RecipeMatch } from "../types";
import type { StockItem, ShoppingList } from "../types";
import { computeRecipeMatches } from "../mockData";
import { colors, fonts } from "../tokens";
import Toggle from "../components/ui/Toggle";
import SectionHeading from "../components/ui/SectionHeading";
import EmptyState from "../components/ui/EmptyState";

interface Props {
  stock: StockItem[];
  setList: React.Dispatch<React.SetStateAction<ShoppingList>>;
}

const QUALITY_META: Record<string, { label: string; color: string; bg: string }> = {
  VERIFIED: { label: "ricetta verificata", color: colors.sageDark, bg: colors.sageLight },
  IMPORTED: { label: "fonte esterna", color: colors.amberDark, bg: colors.amberLight },
  ESTIMATED: { label: "dati stimati", color: colors.inkMuted, bg: colors.creamDark },
  UNKNOWN: { label: "fonte ignota", color: colors.inkMuted, bg: colors.creamDark },
};

function scoreColor(pct: number): string {
  return pct === 100 ? colors.sage : pct >= 60 ? colors.expiring : colors.terracotta;
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
      return { ...l, items: [...l.items, ...newItems], version: l.version + 1, lastEditedAt: new Date().toISOString() };
    });
    setAddedMissing((s) => { const n = new Set(s); n.add(match.recipe.id); return n; });
  }

  if (detail) {
    const qb = QUALITY_META[detail.recipe.quality];
    const pct = Math.round(detail.score * 100);
    const alreadyAdded = addedMissing.has(detail.recipe.id);
    const sc = scoreColor(pct);
    return (
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm font-medium hover:opacity-60 transition-opacity" style={{ color: colors.inkMuted }}>
          ← Tutte le ricette
        </button>
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
          <div className="relative h-52" style={{ backgroundColor: colors.border }}>
            <img
              src={`https://images.unsplash.com/${detail.recipe.image}?w=800&h=400&fit=crop&auto=format`}
              alt={detail.recipe.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(26,21,16,0.65) 0%, transparent 55%)" }} />
            <div className="absolute bottom-4 left-5 right-5">
              <h2 className="text-2xl font-light text-white" style={{ fontFamily: fonts.display }}>{detail.recipe.title}</h2>
              <div className="flex gap-3 mt-1 text-white/70 text-xs">
                <span>⏱ {detail.recipe.time} min</span>
                <span>👥 {detail.recipe.servings} porzioni</span>
                <span>📊 {detail.recipe.difficulty}</span>
                <span>🔥 {detail.recipe.caloriesPerServing} kcal/porz.</span>
              </div>
            </div>
          </div>
          <div className="p-5 space-y-5" style={{ backgroundColor: colors.white }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-2 flex-wrap">
                {detail.recipe.tags.map((t) => (
                  <span key={t} className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>{t}</span>
                ))}
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: qb.bg, color: qb.color }}>{qb.label}</span>
            </div>

            {/* Compatibility bar */}
            <div className="rounded-xl p-3" style={{ backgroundColor: colors.cream }}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold" style={{ color: colors.ink }}>
                  {detail.matchedIngredients.length}/{detail.recipe.ingredients.length} ingredienti in dispensa
                </span>
                <span className="text-sm font-light" style={{ fontFamily: fonts.display, color: sc }}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.border }}>
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: sc }} />
              </div>
            </div>

            {/* Ingredients */}
            <div>
              <SectionHeading>Ingredienti</SectionHeading>
              <div className="space-y-1 mt-2">
                {detail.recipe.ingredients.map((ing) => {
                  const inPantry = detail.matchedIngredients.includes(ing.name);
                  return (
                    <div key={ing.name} className="flex items-center justify-between py-2 border-b" style={{ borderColor: colors.borderLight }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: inPantry ? colors.sage : colors.terracotta }}>{inPantry ? "✓" : "✗"}</span>
                        <span className="text-sm" style={{ color: inPantry ? colors.ink : colors.terracotta }}>{ing.name}</span>
                        {ing.allergens.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>
                            {ing.allergens.join(", ")}
                          </span>
                        )}
                      </div>
                      <span className="text-xs" style={{ color: colors.inkMuted }}>{ing.amount} {ing.unit}</span>
                    </div>
                  );
                })}
              </div>
              {detail.missingIngredients.length > 0 && (
                <button
                  onClick={() => addMissingToCart(detail)}
                  disabled={alreadyAdded}
                  className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ backgroundColor: alreadyAdded ? colors.sageLight : colors.terracotta, color: alreadyAdded ? colors.sageDark : colors.white }}
                >
                  {alreadyAdded ? "Ingredienti mancanti aggiunti alla spesa ✓" : `Aggiungi ${detail.missingIngredients.length} ingredienti mancanti alla spesa`}
                </button>
              )}
            </div>

            {/* Steps */}
            <div>
              <SectionHeading>Preparazione</SectionHeading>
              <ol className="space-y-3 mt-2">
                {detail.recipe.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm" style={{ color: colors.ink }}>
                    <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: colors.amberLight, color: colors.terracotta }}>
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
        <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Ricette</h2>
        <Toggle checked={onlyFeasible} onChange={setOnlyFeasible} label="Solo realizzabili" />
      </div>

      {/* Personalisation consent */}
      {showConsentBanner && !consentGiven && (
        <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: colors.amberLight, border: `1px solid ${colors.border}` }}>
          <p className="text-sm font-medium" style={{ color: colors.ink }}>Ricette personalizzate</p>
          <p className="text-xs leading-relaxed" style={{ color: colors.inkMuted }}>
            Attivando la personalizzazione, le ricette verranno suggerite in base alle abitudini della famiglia. Puoi revocare il consenso in qualsiasi momento dalla sezione Famiglia → Privacy.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConsentGiven(true)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ backgroundColor: colors.terracotta, color: colors.white }}>
              Attiva personalizzazione
            </button>
            <button onClick={() => setShowConsentBanner(false)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
              Non ora
            </button>
          </div>
        </div>
      )}
      {consentGiven && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>
          Personalizzazione attiva · revoca in Famiglia → Privacy
        </div>
      )}

      {matches.length === 0 ? (
        <EmptyState
          icon="👨‍🍳"
          title="Nessuna ricetta realizzabile"
          description='Togli il filtro "solo realizzabili" o aggiungi più ingredienti alla dispensa.'
          action={{ label: "Mostra tutte", onClick: () => setOnlyFeasible(false) }}
        />
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {matches.map((match) => {
            const pct = Math.round(match.score * 100);
            const sc = scoreColor(pct);
            return (
              <button
                key={match.recipe.id}
                onClick={() => setDetail(match)}
                className="rounded-2xl overflow-hidden text-left transition-all hover:scale-[1.01]"
                style={{ border: `1px solid ${colors.border}`, backgroundColor: colors.white }}
                aria-label={`Vedi ricetta: ${match.recipe.title}`}
              >
                <div className="relative h-40" style={{ backgroundColor: colors.border }}>
                  <img
                    src={`https://images.unsplash.com/${match.recipe.image}?w=600&h=280&fit=crop&auto=format`}
                    alt={match.recipe.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(26,21,16,0.5) 0%, transparent 55%)" }} />
                  <div
                    className="absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: pct === 100 ? colors.sageLight : pct >= 60 ? colors.amberLight : colors.terracottaLight, color: sc }}
                  >
                    {match.matchedIngredients.length}/{match.recipe.ingredients.length} ingredienti
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  <h3 className="font-semibold text-sm" style={{ color: colors.ink }}>{match.recipe.title}</h3>
                  <div className="flex gap-3 text-xs" style={{ color: colors.inkMuted }}>
                    <span>⏱ {match.recipe.time} min</span>
                    <span>📊 {match.recipe.difficulty}</span>
                    <span>🔥 {match.recipe.caloriesPerServing} kcal</span>
                  </div>
                  <div className="h-1 rounded-full" style={{ backgroundColor: colors.creamDark }}>
                    <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: sc }} />
                  </div>
                  {match.missingIngredients.length > 0 && (
                    <p className="text-[10px]" style={{ color: colors.terracotta }}>Mancano: {match.missingIngredients.join(", ")}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
