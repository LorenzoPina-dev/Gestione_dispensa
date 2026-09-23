import type { ShoppingItem, ShoppingList, StockItem } from "../types";
import type { ActiveShoppingListDto, ShoppingItemDto, StockItemDto } from "./types";

const DEFAULT_UNIT_FALLBACK = "pz";

/**
 * The real `StockItem` returned by the backend (apps/api/src/inventory/service.ts) has no
 * product name, brand, category, or expiry date — those live on `Product`/`stock_lots`, which
 * this API surface doesn't join or expose yet. So the UI necessarily shows a shortened id as the
 * name and "Generale" as the category for anything that came from the real backend, until a
 * richer read model exists.
 */
export function mapStockItemDtoToUi(dto: StockItemDto): StockItem {
  return {
    id: dto.id,
    name: dto.productName || `Prodotto ${dto.productId.slice(0, 8)}`,
    ...(dto.brand ? { brand: dto.brand } : {}),
    batches: dto.batches?.length ? dto.batches : [{ quantity: dto.quantity }],
    unit: dto.unit || DEFAULT_UNIT_FALLBACK,
    ...(dto.reorderPoint != null ? { reorderPoint: dto.reorderPoint } : {}),
    location: mapLocation(dto.location),
    category: dto.category || "Generale",
    provenance: dto.provenance || "UNKNOWN",
    version: dto.version,
    ...(dto.calories != null ? { calories: dto.calories } : {}),
    ...(dto.protein != null ? { protein: dto.protein } : {}),
    ...(dto.carbs != null ? { carbs: dto.carbs } : {}),
    ...(dto.fat != null ? { fat: dto.fat } : {}),
    ...(dto.fiber != null ? { fiber: dto.fiber } : {}),
  };
}

export function mapShoppingItemDtoToUi(dto: ShoppingItemDto): ShoppingItem {
  return {
    id: dto.id,
    displayName: dto.displayName,
    quantity: dto.quantity,
    unit: dto.unit,
    // Real backend states (SUGGESTED/ACCEPTED/SNOOZED/IGNORED/COMPLETED) already match the UI's
    // ShoppingItemState 1:1, unlike the old openapi.yaml-based mapping — no translation needed.
    state: dto.state,
    sourceType: dto.sourceType,
    ...(dto.sourceRef ? { sourceRef: dto.sourceRef } : {}),
    version: dto.version,
  };
}

export function mapActiveShoppingListDtoToUi(dto: ActiveShoppingListDto): ShoppingList {
  return {
    id: dto.list.id,
    name: dto.list.name,
    status: dto.list.status,
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
