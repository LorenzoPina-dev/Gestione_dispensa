/**
 * Shopping suggestions (WEB-SHP): REORDER suggestions are persisted by Shopping and are read
 * from the owning service. Recipe and offer suggestions remain derived from their remote sources.
 * A reorder suggestion becomes a shopping-list item only when the person adds it; the source remains
 * `low_stock` / REORDER.
 *
 *  - REORDER: current pantry rows whose total quantity is at or below their reorder threshold.
 *  - RECIPE:  ingredients missing for the Recipes suggestions.
 *  - OFFER:   active Stores offers on products we can name.
 */
import {
  convertQuantity,
  formatQuantity,
  formatUnit,
  normalizeUnit,
  roundUpToStep,
  type CanonicalUnit,
} from "./units.js";

export type ShoppingSuggestionSource = "REORDER" | "RECIPE" | "OFFER";

export interface SuggestionStockItem {
  readonly id: string;
  readonly productId?: string;
  readonly name: string;
  readonly unit: string;
  readonly reorderPoint?: number;
  readonly batches: ReadonlyArray<{ readonly quantity: number }>;
}

export interface SuggestionListItem {
  readonly displayName: string;
  readonly productId?: string;
}

export interface ShoppingSuggestion {
  readonly key: string;
  readonly source: ShoppingSuggestionSource;
  readonly label: string;
  readonly productId?: string;
  readonly quantity: number;
  readonly unit: CanonicalUnit;
  readonly sourceRef?: string;
  readonly reason: string;
  /** Catalog metadata used to render the same product preview as the search tab. */
  readonly imageUrl?: string;
  readonly brand?: string;
  readonly packageLabel?: string;
  /** Recipe title or store name, used to group rows in the picker. */
  readonly group?: string;
}

/** Lower-case, accent-free, punctuation-free form used to compare product names. */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestionKey(input: { readonly productId?: string; readonly label: string }): string {
  return input.productId ? `p:${input.productId}` : `n:${normalizeLabel(input.label)}`;
}

export function isAlreadyListed(
  list: readonly SuggestionListItem[],
  candidate: { readonly productId?: string; readonly label: string },
): boolean {
  const label = normalizeLabel(candidate.label);
  return list.some(
    (item) =>
      (candidate.productId !== undefined && item.productId === candidate.productId) ||
      (label !== "" && normalizeLabel(item.displayName) === label),
  );
}

function stockQuantity(item: SuggestionStockItem): number {
  return item.batches.reduce((sum, batch) => sum + batch.quantity, 0);
}

function sortByLabel(items: ShoppingSuggestion[]): ShoppingSuggestion[] {
  return items.sort((a, b) => a.label.localeCompare(b.label, "it"));
}

/**
 * Pantry rows of the same product (one per purchase/lot) are summed before comparing with the
 * threshold. The suggested quantity is the shortfall rounded up to one stepper increment.
 */
export function deriveReorderSuggestions(
  stock: readonly SuggestionStockItem[],
  list: readonly SuggestionListItem[],
): ShoppingSuggestion[] {
  const groups = new Map<
    string,
    { name: string; productId?: string; unit: CanonicalUnit; total: number; threshold?: number; ref: string }
  >();

  for (const item of stock) {
    const key = item.productId ? `p:${item.productId}` : `n:${normalizeLabel(item.name)}`;
    const unit = normalizeUnit(item.unit);
    const quantity = stockQuantity(item);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        name: item.name,
        ...(item.productId ? { productId: item.productId } : {}),
        unit,
        total: quantity,
        ...(item.reorderPoint !== undefined ? { threshold: item.reorderPoint } : {}),
        ref: item.id,
      });
      continue;
    }
    const converted = convertQuantity(quantity, unit, existing.unit);
    if (converted !== null) existing.total += converted;
    if (item.reorderPoint !== undefined) {
      existing.threshold = Math.max(existing.threshold ?? 0, item.reorderPoint);
    }
  }

  const suggestions: ShoppingSuggestion[] = [];
  for (const [key, group] of groups) {
    if (group.threshold === undefined || group.total > group.threshold) continue;
    if (isAlreadyListed(list, { productId: group.productId, label: group.name })) continue;
    suggestions.push({
      key,
      source: "REORDER",
      label: group.name,
      ...(group.productId ? { productId: group.productId } : {}),
      quantity: roundUpToStep(group.threshold - group.total, group.unit),
      unit: group.unit,
      sourceRef: group.ref,
      reason: `Ne restano ${formatQuantity(group.total)} ${formatUnit(group.unit)} (soglia ${formatQuantity(group.threshold)})`,
    });
  }
  return sortByLabel(suggestions);
}

export interface RecipeSuggestionSource {
  readonly recipeId: string;
  readonly title: string;
  readonly missing: ReadonlyArray<{
    readonly productId?: string;
    readonly name: string;
    readonly quantity?: number;
    readonly unit?: string;
  }>;
}

/** Missing ingredients, merged across recipes (same product => one row, quantities summed). */
export function deriveRecipeSuggestions(
  recipes: readonly RecipeSuggestionSource[],
  list: readonly SuggestionListItem[],
): ShoppingSuggestion[] {
  const merged = new Map<string, ShoppingSuggestion & { titles: string[] }>();

  for (const recipe of recipes) {
    for (const missing of recipe.missing) {
      const label = missing.name.trim();
      if (label === "") continue;
      const productId = missing.productId || undefined;
      if (isAlreadyListed(list, { productId, label })) continue;

      const key = suggestionKey({ productId, label });
      const unit = normalizeUnit(missing.unit);
      const quantity =
        missing.quantity !== undefined && Number.isFinite(missing.quantity) && missing.quantity > 0
          ? missing.quantity
          : 1;
      const existing = merged.get(key);
      if (existing) {
        if (!existing.titles.includes(recipe.title)) existing.titles.push(recipe.title);
        if (existing.unit === unit) {
          merged.set(key, { ...existing, quantity: Math.round((existing.quantity + quantity) * 1000) / 1000 });
        }
        continue;
      }
      merged.set(key, {
        key,
        source: "RECIPE",
        label,
        ...(productId ? { productId } : {}),
        quantity,
        unit,
        sourceRef: recipe.recipeId,
        reason: "",
        group: recipe.title,
        titles: [recipe.title],
      });
    }
  }

  return sortByLabel(
    [...merged.values()].map(({ titles, ...suggestion }) => ({
      ...suggestion,
      reason: `Per: ${titles.join(", ")}`,
    })),
  );
}

export interface OfferSuggestionSource {
  readonly offerId: string;
  readonly productId: string;
  readonly storeName: string;
  readonly type: "percentage" | "fixed";
  readonly value: number;
  /** Resolved through Catalog; offers on products we cannot name are skipped. */
  readonly productName?: string;
}

export function deriveOfferSuggestions(
  offers: readonly OfferSuggestionSource[],
  list: readonly SuggestionListItem[],
): ShoppingSuggestion[] {
  const best = new Map<string, OfferSuggestionSource>();
  for (const offer of offers) {
    if (!offer.productName || offer.productName.trim() === "") continue;
    const current = best.get(offer.productId);
    if (!current || (offer.type === "percentage" && current.type === "percentage" && offer.value > current.value)) {
      best.set(offer.productId, offer);
    }
  }

  const suggestions: ShoppingSuggestion[] = [];
  for (const offer of best.values()) {
    const label = (offer.productName ?? "").trim();
    if (isAlreadyListed(list, { productId: offer.productId, label })) continue;
    suggestions.push({
      key: `p:${offer.productId}`,
      source: "OFFER",
      label,
      productId: offer.productId,
      quantity: 1,
      unit: "piece",
      sourceRef: offer.offerId,
      group: offer.storeName,
      reason:
        offer.type === "percentage"
          ? `-${formatQuantity(offer.value)}% da ${offer.storeName}`
          : `Sconto di ${formatQuantity(offer.value)} da ${offer.storeName}`,
    });
  }
  return sortByLabel(suggestions);
}
