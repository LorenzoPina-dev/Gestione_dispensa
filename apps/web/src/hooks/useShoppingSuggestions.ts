import { useEffect, useMemo, useRef, useState } from "react";
import type { ShoppingList, StockItem } from "../types";
import type { CatalogProductSummaryDto, RecipeMatchDto } from "../api/types";
import * as api from "../api/endpoints";
import { isBackendUnreachable } from "../api/client";
import { convertQuantity, normalizeUnit, type CanonicalUnit } from "../domain/units";
import {
  deriveOfferSuggestions,
  deriveRecipeSuggestions,
  isAlreadyListed,
  normalizeLabel,
  type OfferSuggestionSource,
  type RecipeSuggestionSource,
  type ShoppingSuggestion,
} from "../domain/shopping-suggestions";

export type PickerTab = "REORDER" | "RECIPE" | "OFFER" | "SEARCH";
type Remote = "REORDER" | "RECIPE" | "OFFER";

interface Args {
  familyId: string | null | undefined;
  open: boolean;
  tab: PickerTab;
  stock: StockItem[];
  list: ShoppingList;
}

export interface UseShoppingSuggestionsResult {
  reorder: ShoppingSuggestion[];
  recipe: ShoppingSuggestion[];
  offer: ShoppingSuggestion[];
  loading: Record<Remote, boolean>;
  error: Record<Remote, string | null>;
}

function toRecipeSource(match: RecipeMatchDto): RecipeSuggestionSource {
  const recipe = match.recipe;
  const ingredients = recipe.ingredients ?? [];
  return {
    recipeId: recipe.id ?? recipe.recipeId ?? "",
    title: recipe.title,
    missing: match.missingIngredients.map((ingredient) => {
      const name = ingredient.displayName ?? ingredient.name ?? "Ingrediente";
      // Suggestions may carry only {productId,name}: fall back to the amount the recipe asks for.
      const full = ingredients.find(
        (x) =>
          (ingredient.productId && x.productId === ingredient.productId) ||
          normalizeLabel(x.displayName ?? x.name ?? "") === normalizeLabel(name),
      );
      return {
        ...(ingredient.productId ? { productId: ingredient.productId } : {}),
        name,
        quantity: ingredient.quantity ?? ingredient.amount ?? full?.quantity ?? full?.amount,
        unit: ingredient.unit ?? full?.unit,
      };
    }),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function packageAwarePurchase(
  quantity: number,
  unit: string,
  packageValue?: number,
  packageUnit?: string,
): { quantity: number; unit: CanonicalUnit } {
  const normalizedUnit = normalizeUnit(unit);
  if (
    packageValue == null ||
    !Number.isFinite(packageValue) ||
    packageValue <= 0 ||
    !packageUnit?.trim()
  ) {
    return { quantity, unit: normalizedUnit };
  }

  const normalizedPackageUnit = normalizeUnit(packageUnit);
  const quantityInPackageUnit = convertQuantity(quantity, normalizedUnit, normalizedPackageUnit);
  if (quantityInPackageUnit == null) {
    return { quantity, unit: normalizedUnit };
  }

  const packageCount = Math.max(1, Math.ceil((quantityInPackageUnit / packageValue) - 1e-9));
  return {
    quantity: round3(packageCount * packageValue),
    unit: normalizedPackageUnit,
  };
}

async function fetchOffers(signal: AbortSignal): Promise<OfferSuggestionSource[]> {
  const { stores } = await api.listStores(undefined, 10, signal);
  const perStore = await Promise.all(
    stores.map(async (store) => ({
      store,
      offers: (await api.listStoreOffers(store.storeId, 20, signal)).offers,
    })),
  );
  const flat = perStore.flatMap(({ store, offers }) => offers.map((offer) => ({ store, offer })));
  const productIds = [...new Set(flat.map(({ offer }) => offer.productId))].slice(0, 100);
  const products = await api.getCatalogProductsBatch(productIds, signal);
  const byId = new Map(products.map((product) => [product.id, product]));

  return flat.map(({ store, offer }) => {
    const product = byId.get(offer.productId);
    return {
      offerId: offer.offerId,
      productId: offer.productId,
      storeName: store.name,
      type: offer.type,
      value: offer.value,
      ...(product?.name ? { productName: product.name } : {}),
    };
  });
}

/**
 * Suggestions for the "+" picker. Reorder suggestions are persisted by Shopping; recipes and
 * offers are read lazily (only while their tab is open) from Recipes and Stores through the gateway.
 */
export function useShoppingSuggestions({ familyId, open, tab, stock, list }: Args): UseShoppingSuggestionsResult {
  const [remoteReorder, setRemoteReorder] = useState<Array<{
    suggestionId: string;
    productId: string;
    quantity: number;
    unit: string;
    reorderPoint: number;
    name?: string;
    brand?: string;
    imageUrl?: string;
    packageLabel?: string;
    packageValue?: number;
    packageUnit?: string;
  }>>([]);
  const catalogCache = useRef(new Map<string, CatalogProductSummaryDto>());
  const [recipes, setRecipes] = useState<RecipeSuggestionSource[]>([]);
  const [offers, setOffers] = useState<OfferSuggestionSource[]>([]);
  const [loading, setLoading] = useState<Record<Remote, boolean>>({ REORDER: false, RECIPE: false, OFFER: false });
  const [error, setError] = useState<Record<Remote, string | null>>({ REORDER: null, RECIPE: null, OFFER: null });

  const patch = <T,>(setter: React.Dispatch<React.SetStateAction<Record<Remote, T>>>, key: Remote, value: T) =>
    setter((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open || !familyId || (tab !== "REORDER" && tab !== "RECIPE" && tab !== "OFFER")) return;
    const key: Remote = tab;
    const controller = new AbortController();
    patch<boolean>(setLoading, key, true);
    patch<string | null>(setError, key, null);

    const run = key === "REORDER"
      ? api.listReorderSuggestions(familyId).then(async ({ suggestions }) => {
          const products = await api.getCatalogProductsBatch(
            suggestions.map((item) => item.productId),
            controller.signal,
          );
          const byId = new Map(products.map((product) => [product.id, product]));
          for (const product of products) catalogCache.current.set(product.productId, product);

          const enriched = suggestions.map((item) => {
            const fallback = {
              suggestionId: item.suggestionId,
              productId: item.productId,
              quantity: item.quantity,
              unit: item.unit,
              reorderPoint: item.reorderPoint,
            };
            const cached = byId.get(item.productId);
            if (!cached) return fallback;
            return {
              ...fallback,
              name: cached.name.trim() || undefined,
              brand: cached.brand?.trim() || undefined,
              imageUrl: cached.imageObjectKey
                ?? cached.images?.front
                ?? cached.images?.frontSmall
                ?? cached.images?.frontThumb
                ?? undefined,
              packageLabel: cached.package?.label?.trim() || undefined,
              packageValue: cached.package?.value ?? undefined,
              packageUnit: cached.package?.unit?.trim() || undefined,
            };
          });

          if (!controller.signal.aborted) setRemoteReorder(enriched);
        })
      : key === "RECIPE"
        ? api.listRecipeSuggestions(familyId).then(({ suggestions }) => setRecipes(suggestions.map(toRecipeSource)))
        : fetchOffers(controller.signal).then(setOffers);

    run
      .catch((err) => {
        if (controller.signal.aborted) return;
        patch<string | null>(setError, key, isBackendUnreachable(err) ? "Impossibile contattare il server." : "Suggerimenti non disponibili al momento.");
      })
      .finally(() => {
        if (!controller.signal.aborted) patch<boolean>(setLoading, key, false);
      });

    return () => controller.abort();
  }, [open, tab, familyId]);

  const reorder = useMemo(
    () =>
      remoteReorder
        .map((suggestion) => ({
          key: `p:${suggestion.productId}`,
          source: "REORDER" as const,
          label: suggestion.name ?? `Prodotto ${suggestion.productId.slice(0, 8)}`,
          ...(suggestion.brand ? { brand: suggestion.brand } : {}),
          ...(suggestion.imageUrl ? { imageUrl: suggestion.imageUrl } : {}),
          ...(suggestion.packageLabel ? { packageLabel: suggestion.packageLabel } : {}),
          productId: suggestion.productId,
          ...packageAwarePurchase(
            suggestion.quantity,
            suggestion.unit,
            suggestion.packageValue,
            suggestion.packageUnit,
          ),
          sourceRef: suggestion.suggestionId,
          reason:
            suggestion.reorderPoint === 0
              ? "Scorta esaurita"
              : `Scorta sotto la soglia di ${suggestion.reorderPoint}`,
        }))
        .filter((suggestion) => !isAlreadyListed(list.items, suggestion)),
    [remoteReorder, list.items],
  );
  const recipe = useMemo(() => deriveRecipeSuggestions(recipes, list.items), [recipes, list.items]);
  const offer = useMemo(() => deriveOfferSuggestions(offers, list.items), [offers, list.items]);

  return { reorder, recipe, offer, loading, error };
}
