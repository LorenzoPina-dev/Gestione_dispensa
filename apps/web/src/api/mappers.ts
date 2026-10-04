import type { ShoppingItem, ShoppingItemSource, ShoppingList, StockItem } from "../types";
import type { ActiveShoppingListDto, ShoppingItemDto, StockItemDto } from "./types";

const DEFAULT_UNIT_FALLBACK = "pz";

/**
 * The real `StockItem` returned by the backend (services/inventory/service.ts) has no
 * product name, brand, category, or expiry date — those live on `Product`/`stock_lots`, which
 * this API surface doesn't join or expose yet. So the UI necessarily shows a shortened id as the
 * name and "Generale" as the category for anything that came from the real backend, until a
 * richer read model exists.
 */
export function mapStockItemDtoToUi(dto: StockItemDto): StockItem {
  return {
    id: dto.id ?? dto.itemId ?? "",
    productId: dto.productId,
    name: dto.productName || dto.name || `Prodotto ${dto.productId.slice(0, 8)}`,
    ...(dto.brand ? { brand: dto.brand } : {}),
    batches: dto.batches?.length
      ? dto.batches
      : [{ quantity: dto.quantity, ...(dto.expiresAt ? { expiryDate: dto.expiresAt } : {}) }],
    unit: dto.unit || DEFAULT_UNIT_FALLBACK,
    ...(dto.reorderPoint != null ? { reorderPoint: dto.reorderPoint } : {}),
    location: mapLocation(dto.location),
    category: dto.category || "Generale",
    provenance: dto.provenance || "UNKNOWN",
    version: dto.version ?? 1,
    ...(dto.calories != null ? { calories: dto.calories } : {}),
    ...(dto.protein != null ? { protein: dto.protein } : {}),
    ...(dto.carbs != null ? { carbs: dto.carbs } : {}),
    ...(dto.fat != null ? { fat: dto.fat } : {}),
    ...(dto.fiber != null ? { fiber: dto.fiber } : {}),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Backend vocabulary (docs/EVENTS.md): manual | recipe | low_stock | offer. */
export type ShoppingSourceApi = "manual" | "recipe" | "low_stock" | "offer";

export function shoppingSourceFromApi(source: string | null | undefined): ShoppingItemSource {
  switch (String(source ?? "").toLowerCase()) {
    case "recipe": return "RECIPE";
    case "low_stock":
    case "reorder": return "REORDER";
    case "offer": return "OFFER";
    default: return "MANUAL";
  }
}

export function shoppingSourceToApi(sourceType: ShoppingItemSource | string | undefined): ShoppingSourceApi {
  switch (sourceType) {
    case "RECIPE": return "recipe";
    case "REORDER": return "low_stock";
    case "OFFER": return "offer";
    default: return "manual";
  }
}

export function mapShoppingItemDtoToUi(dto: ShoppingItemDto): ShoppingItem {
  return {
    id: dto.itemId,
    displayName: dto.displayName ?? dto.label,
    quantity: dto.quantity,
    unit: dto.unit,
    // Shopping persists a single flag. unchecked = still to buy (ACCEPTED), checked = in the cart
    // (COMPLETED). SUGGESTED is never stored: suggestions are derived client-side from Inventory,
    // Recipes and Stores (domain/shopping-suggestions.ts) and become items only when added.
    state: dto.state ?? (dto.checked ? "COMPLETED" : "ACCEPTED"),
    sourceType: dto.sourceType ?? shoppingSourceFromApi(dto.source),
    ...(dto.productId ? { productId: dto.productId } : {}),
    ...(dto.sourceRef ? { sourceRef: dto.sourceRef } : {}),
    version: dto.version,
  };
}

export function mapActiveShoppingListDtoToUi(dto: ActiveShoppingListDto): ShoppingList {
  return {
    id: dto.list.listId,
    name: dto.list.name,
    status: dto.list.status === "open" ? "ACTIVE" : "ARCHIVED",
    version: dto.list.version,
    items: dto.items.map(mapShoppingItemDtoToUi),
  };
}

function mapLocation(value?: string): StockItem["location"] {
  const v = (value || "").toUpperCase();
  if (v === "FRIDGE" || v === "FRIGO") return "frigo";
  if (v === "FREEZER") return "freezer";
  if (v === "PANTRY" || v === "DISPENSA") return "dispensa";
  return "altro";
}
