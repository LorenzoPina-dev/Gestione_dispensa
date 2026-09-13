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
    name: `Prodotto ${dto.productId.slice(0, 8)}`,
    batches: [{ quantity: dto.quantity }],
    unit: dto.unit || DEFAULT_UNIT_FALLBACK,
    ...(dto.reorderPoint != null ? { reorderPoint: dto.reorderPoint } : {}),
    location: "dispensa",
    category: "Generale",
    provenance: "UNKNOWN",
    version: dto.version,
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
