import { useEffect, useMemo, useState } from "react";
import type { RecipeMatchDto } from "../../api/types";
import type { Recipe, RecipeMatch, StockItem } from "../../types";
import { colors, fonts } from "../../tokens";
import SectionHeading from "../ui/SectionHeading";

type PantryUsage = NonNullable<RecipeMatchDto["pantryProductsUsed"]>[number];
export type RecipeMatchWithUsage = RecipeMatch & { pantryProductsUsed?: PantryUsage[] };

interface Props {
  match: RecipeMatchWithUsage;
  stock: StockItem[];
  setStock: React.Dispatch<React.SetStateAction<StockItem[]>>;
  readOnly?: boolean;
  onBack: () => void;
  onShopMissing: () => void;
}

interface ConsumptionPlan {
  stockItemId: string;
  quantity: number;
}

interface ManualDose {
  amount: string;
  unit: string;
  productId: string;
}

function availableQuantity(item: StockItem): number {
  return item.batches.reduce((total, batch) => total + batch.quantity, 0);
}

function baseToInventoryQuantity(usage: PantryUsage, item: StockItem, servingsRatio: number): number | null {
  const baseQuantity = usage.usedBaseQuantity * servingsRatio;
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) return null;
  const unit = item.unit.toLowerCase();
  if (usage.usedBaseUnit === "g" && unit === "g") return baseQuantity;
  if (usage.usedBaseUnit === "g" && unit === "kg") return baseQuantity / 1000;
  if (usage.usedBaseUnit === "ml" && unit === "ml") return baseQuantity;
  if (usage.usedBaseUnit === "ml" && unit === "l") return baseQuantity / 1000;
  if (usage.usedBaseUnit === "piece" && unit === "piece") return baseQuantity;

  const packageQuantity = usage.quantityBase;
  if (
    packageQuantity &&
    packageQuantity.value > 0 &&
    packageQuantity.unit === usage.usedBaseUnit &&
    (unit === "pack" || unit === "piece")
  ) {
    return baseQuantity / packageQuantity.value;
  }
  return null;
}

function expiryOrder(item: StockItem): number {
  const values = item.batches
    .map((batch) => batch.expiryDate ? Date.parse(batch.expiryDate) : Number.POSITIVE_INFINITY)
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : Number.POSITIVE_INFINITY;
}

function planConsumption(
  usages: PantryUsage[] | undefined,
  stock: StockItem[],
  servingsRatio: number,
  manualDoses: Record<string, ManualDose>,
  ingredients: Recipe["ingredients"],
): ConsumptionPlan[] {
  if (!usages?.length) throw new Error("Non ho dati di dispensa sufficienti per calcolare il consumo.");
  const byProduct = new Map<string, PantryUsage>();
  for (const usage of usages) {
    const current = byProduct.get(usage.productId);
    // The API repeats the same product-level allocation for each pantry lot.
    if (!current || usage.usedBaseQuantity > current.usedBaseQuantity) byProduct.set(usage.productId, usage);
  }

  for (const ingredient of ingredients.filter((item) => !Number.isFinite(item.amount) || item.amount <= 0)) {
    const dose = manualDoses[ingredient.name];
    const amount = Number(dose?.amount);
    const unit = dose?.unit;
    if (!Number.isFinite(amount) || amount <= 0 || (unit !== "g" && unit !== "ml" && unit !== "piece")) {
      throw new Error(`Inserisci una dose in g, ml o pezzi per ${ingredient.name}.`);
    }
    const ingredientKey = ingredient.name.trim().toLocaleLowerCase("it-IT");
    const options = [...byProduct.values()].filter((usage) =>
      usage.usedFor?.some((name) => name.trim().toLocaleLowerCase("it-IT") === ingredientKey),
    );
    if (!options.length) throw new Error(`Non trovo un prodotto abbinato a ${ingredient.name}.`);
    const selected = dose.productId
      ? options.find((usage) => usage.productId === dose.productId)
      : options.length === 1 ? options[0] : undefined;
    if (!selected) throw new Error(`Scegli quale prodotto usare per ${ingredient.name}.`);
    if (selected.usedBaseQuantity > 0 && selected.usedBaseUnit !== unit) {
      throw new Error(`La dose manuale di ${ingredient.name} usa un'unità incompatibile con le altre dosi dello stesso prodotto.`);
    }
    byProduct.set(selected.productId, {
      ...selected,
      usedBaseQuantity: selected.usedBaseQuantity + amount,
      usedBaseUnit: unit,
      usedFor: [...new Set([...(selected.usedFor ?? []), ingredient.name])],
    });
  }

  const plan = new Map<string, number>();
  for (const usage of byProduct.values()) {
    if (usage.usedBaseQuantity <= 0) {
      throw new Error(`Dose non disponibile per ${usage.name}; completa la ricetta dopo aver inserito quantità attendibili.`);
    }
    const candidates = stock
      .filter((item) => item.productId === usage.productId)
      .sort((a, b) => expiryOrder(a) - expiryOrder(b));
    const groups = new Map<string, StockItem[]>();
    for (const item of candidates) {
      const key = item.unit.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }

    let allocated = false;
    for (const items of groups.values()) {
      const converted = items.map((item) => ({
        item,
        quantity: baseToInventoryQuantity(usage, item, servingsRatio),
      }));
      if (converted.some(({ quantity }) => quantity === null)) continue;
      const capacity = converted.reduce((total, entry) => total + availableQuantity(entry.item), 0);
      const totalNeeded = converted[0]?.quantity;
      if (totalNeeded === null || totalNeeded === undefined || totalNeeded > capacity + 0.000001) continue;

      let remaining = totalNeeded;
      for (const { item } of converted) {
        const consumed = Math.min(availableQuantity(item), remaining);
        if (consumed > 0) plan.set(item.id, (plan.get(item.id) ?? 0) + consumed);
        remaining -= consumed;
        if (remaining <= 0.000001) break;
      }
      allocated = true;
      break;
    }
    if (!allocated) {
      throw new Error(`Quantità disponibile insufficiente o unità non convertibile per ${usage.name}.`);
    }
  }

  return [...plan].map(([stockItemId, quantity]) => ({
    stockItemId,
    quantity: Math.round(quantity * 1000000) / 1000000,
  }));
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function scaledAmount(amount: number, ratio: number): string {
  return Number.isFinite(amount) && amount > 0 ? `${formatQuantity(amount * ratio)}` : "q.b.";
}

export default function RecipeDetail({ match, stock, setStock, readOnly = false, onBack, onShopMissing }: Props) {
  const baseServings = Math.max(1, match.recipe.servings || 1);
  const [servings, setServings] = useState(baseServings);
  const [completed, setCompleted] = useState(false);
  const [manualDoses, setManualDoses] = useState<Record<string, ManualDose>>({});
  useEffect(() => setServings(baseServings), [baseServings]);
  const ratio = servings / baseServings;
  const unknownDoseIngredients = match.recipe.ingredients.filter((ingredient) => !Number.isFinite(ingredient.amount) || ingredient.amount <= 0);
  const completeInPantry = match.score >= 1 && match.missingIngredients.length === 0;
  const plan = useMemo(() => {
    if (!completeInPantry) return { items: [] as ConsumptionPlan[], error: null as string | null };
    try {
      return { items: planConsumption(match.pantryProductsUsed, stock, ratio, manualDoses, match.recipe.ingredients), error: null as string | null };
    } catch (error) {
      return { items: [] as ConsumptionPlan[], error: error instanceof Error ? error.message : "Impossibile calcolare il consumo." };
    }
  }, [completeInPantry, manualDoses, match.pantryProductsUsed, match.recipe.ingredients, ratio, stock]);

  const completeRecipe = () => {
    if (plan.error || !plan.items.length) return;
    const quantities = new Map(plan.items.map((item) => [item.stockItemId, item.quantity]));
    setStock((current) => current.map((item) => {
      const consumed = quantities.get(item.id);
      if (consumed === undefined) return item;
      let remaining = consumed;
      const batches = item.batches.map((batch) => {
        const fromBatch = Math.min(batch.quantity, remaining);
        remaining -= fromBatch;
        return { ...batch, quantity: Math.max(0, batch.quantity - fromBatch) };
      });
      return { ...item, batches };
    }));
    setCompleted(true);
  };

  const quality = match.recipe.quality;
  const percent = Math.round(match.score * 100);
  const scoreColor = percent === 100 ? colors.sage : percent >= 60 ? colors.expiring : colors.terracotta;
  const totalCalories = match.recipe.caloriesPerServing > 0
    ? Math.round(match.recipe.caloriesPerServing * servings)
    : null;

  return (
    <div className="space-y-6">
      <button onClick={onBack} aria-label="Torna alle ricette" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium" style={{ color: colors.ink, backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
        <span aria-hidden="true" className="text-lg leading-none">←</span><span>Torna alle ricette</span>
      </button>
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
        <div className="relative h-52" style={{ backgroundColor: colors.border }}>
          {match.recipe.image && <img src={match.recipe.image} alt={match.recipe.title} className="w-full h-full object-cover" />}
          <div className="absolute bottom-4 left-5 right-5">
            <h2 className="text-2xl font-light text-white" style={{ fontFamily: fonts.display }}>{match.recipe.title}</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-white/70 text-xs">
              <span>⏱ {match.recipe.time} min</span><span>👥 {servings} porzioni</span><span>📊 {match.recipe.difficulty}</span>
              {totalCalories !== null && <span>🔥 {totalCalories} kcal totali stimate</span>}
            </div>
          </div>
        </div>
        <div className="p-5 space-y-5" style={{ backgroundColor: colors.white }}>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2 flex-wrap">{match.recipe.tags.map((tag) => <span key={tag} className="px-2.5 py-0.5 rounded-full text-xs" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>{tag}</span>)}</div>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: quality === "VERIFIED" ? colors.sageLight : colors.amberLight, color: quality === "VERIFIED" ? colors.sageDark : colors.amberDark }}>{quality === "VERIFIED" ? "ricetta verificata" : "fonte esterna"}</span>
          </div>

          <section className="rounded-xl p-4" style={{ backgroundColor: colors.cream }}>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-semibold">Calcolatore porzioni</p><p className="text-xs mt-1" style={{ color: colors.inkMuted }}>Le dosi degli ingredienti si aggiornano in proporzione.</p></div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Una porzione in meno" onClick={() => setServings((value) => Math.max(1, value - 1))} className="h-9 w-9 rounded-lg" style={{ backgroundColor: colors.white, color: colors.ink }}>−</button>
                <input aria-label="Numero di porzioni" type="number" min={1} max={100} step={1} value={servings} onChange={(event) => setServings(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="h-9 w-16 rounded-lg border text-center" style={{ borderColor: colors.border, color: colors.ink }} />
                <button type="button" aria-label="Una porzione in più" onClick={() => setServings((value) => Math.min(100, value + 1))} className="h-9 w-9 rounded-lg" style={{ backgroundColor: colors.white, color: colors.ink }}>+</button>
              </div>
            </div>
            {totalCalories !== null && <p className="text-xs mt-3" style={{ color: colors.inkMuted }}>Circa {formatQuantity(match.recipe.caloriesPerServing)} kcal a porzione · {totalCalories} kcal in totale.</p>}
          </section>

          <div className="rounded-xl p-3" style={{ backgroundColor: colors.cream }}>
            <div className="flex justify-between mb-2"><span className="text-xs font-semibold">{match.matchedIngredients.length}/{match.recipe.ingredients.length} ingredienti in dispensa</span><span style={{ color: scoreColor }}>{percent}%</span></div>
            <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.border }}><div className="h-1.5 rounded-full" style={{ width: `${percent}%`, backgroundColor: scoreColor }} /></div>
          </div>

          <div>
            <SectionHeading>Ingredienti · {servings} porzioni</SectionHeading>
            {match.recipe.ingredients.map((ingredient) => {
              const present = match.matchedIngredients.includes(ingredient.name);
              const doseKnown = Number.isFinite(ingredient.amount) && ingredient.amount > 0;
              const ingredientKey = ingredient.name.trim().toLocaleLowerCase("it-IT");
              const productOptions = [...new Map((match.pantryProductsUsed ?? [])
                .filter((usage) => usage.usedFor?.some((name) => name.trim().toLocaleLowerCase("it-IT") === ingredientKey))
                .map((usage) => [usage.productId, usage])).values()];
              const dose = manualDoses[ingredient.name] ?? { amount: "", unit: "", productId: "" };
              return <div key={`${ingredient.name}-${ingredient.amount}`} className="py-2 border-b" style={{ borderColor: colors.borderLight }}>
                <div className="flex justify-between gap-3">
                  <span className="text-sm" style={{ color: present ? colors.ink : colors.terracotta }}>{present ? "✓" : "✗"} {ingredient.name}</span>
                  <span className="text-xs" style={{ color: colors.inkMuted }}>{doseKnown ? `${scaledAmount(ingredient.amount, ratio)} ${ingredient.unit}` : Number(dose.amount) > 0 && dose.unit ? `${formatQuantity(Number(dose.amount) * ratio)} ${dose.unit === "piece" ? "pezzi" : dose.unit}` : "q.b."}</span>
                </div>
                {!doseKnown && <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs" style={{ color: colors.inkMuted }}>Dose per {baseServings} porzioni:</span>
                  <input aria-label={`Quantità di ${ingredient.name}`} type="number" min="0.001" step="any" value={dose.amount} disabled={readOnly} onChange={(event) => setManualDoses((current) => ({ ...current, [ingredient.name]: { ...dose, amount: event.target.value } }))} className="h-8 w-20 rounded-lg border px-2 text-xs" style={{ borderColor: colors.border, color: colors.ink }} />
                  <select aria-label={`Unità di ${ingredient.name}`} value={dose.unit} disabled={readOnly} onChange={(event) => setManualDoses((current) => ({ ...current, [ingredient.name]: { ...dose, unit: event.target.value } }))} className="h-8 rounded-lg border px-2 text-xs" style={{ borderColor: colors.border, color: colors.ink }}>
                    <option value="">Unità</option><option value="g">g</option><option value="ml">ml</option><option value="piece">pezzi</option>
                  </select>
                  {productOptions.length > 1 && <select aria-label={`Prodotto da usare per ${ingredient.name}`} value={dose.productId} disabled={readOnly} onChange={(event) => setManualDoses((current) => ({ ...current, [ingredient.name]: { ...dose, productId: event.target.value } }))} className="h-8 max-w-full rounded-lg border px-2 text-xs" style={{ borderColor: colors.border, color: colors.ink }}>
                    <option value="">Scegli prodotto</option>{productOptions.map((usage) => <option key={usage.productId} value={usage.productId}>{usage.name}</option>)}
                  </select>}
                </div>}
              </div>;
            })}
            {match.missingIngredients.length > 0 && <button onClick={onShopMissing} className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: colors.terracotta, color: colors.white }}>Scegli cosa acquistare · {match.missingIngredients.length} {match.missingIngredients.length === 1 ? "mancante" : "mancanti"}</button>}
          </div>

          <section className="space-y-2">
            <button type="button" onClick={completeRecipe} disabled={readOnly || completed || !completeInPantry || Boolean(plan.error)} className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: completed ? colors.sage : colors.terracotta, color: colors.white }}>
              {completed ? "✓ Completata" : "Completa ricetta"}
            </button>
            <p className="text-xs" style={{ color: colors.inkMuted }}>Il consumo riduce le dosi usate in dispensa e aggiorna il diario nutrienti tramite i movimenti registrati.</p>
            {readOnly && <p className="text-xs" style={{ color: colors.inkMuted }}>Il tuo ruolo consente la sola lettura della dispensa.</p>}
            {!completeInPantry && <p className="text-xs" style={{ color: colors.terracotta }}>Completa prima gli ingredienti mancanti in dispensa.</p>}
            {plan.error && <p role="alert" className="text-xs" style={{ color: colors.terracotta }}>{plan.error}</p>}
            {completed && <p role="status" className="text-xs" style={{ color: colors.sageDark }}>Consumo inviato. I nutrienti appariranno dopo l’elaborazione del movimento.</p>}
          </section>

          <div>
            <SectionHeading>Preparazione</SectionHeading>
            <ol className="space-y-3 mt-2">{match.recipe.steps.map((step, index) => <li key={index} className="flex gap-3 text-sm"><span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: colors.amberLight, color: colors.terracotta }}>{index + 1}</span>{step}</li>)}</ol>
          </div>
        </div>
      </div>
    </div>
  );
}
