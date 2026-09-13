import { apiRequest, newIdempotencyKey } from "./client";
import type {
  ActiveShoppingListDto,
  AddShoppingItemResultDto,
  CreatedInviteDto,
  FamilyCreationResultDto,
  InventoryUnit,
  JoinAttemptDto,
  MovementKind,
  ProductDto,
  ProductUnit,
  ReadinessDto,
  ShoppingSourceType,
  StockItemDto,
  RecordMovementResultDto,
  InviteRole,
} from "./types";

// --- Platform ----------------------------------------------------------------

export function getReadiness(): Promise<ReadinessDto> {
  return apiRequest<ReadinessDto>("/health/ready");
}

// --- Family (POST /api/v1/families, /invites, /invites/resolve|accept) -------
// There is no GET for families or members in the current backend — see
// docs comment in config.ts. Only these write endpoints exist.

export function createFamily(input: {
  displayName: string;
  locale: string;
  timezone: string;
  unitSystem: "METRIC" | "IMPERIAL";
}): Promise<FamilyCreationResultDto> {
  return apiRequest("/families", { method: "POST", body: input });
}

export function createFamilyInvite(
  familyId: string,
  input: { role: InviteRole; expiresInSeconds: number },
): Promise<CreatedInviteDto> {
  return apiRequest(`/families/${familyId}/invites`, { method: "POST", body: input });
}

export function resolveInvite(
  token: string,
  browserBindingHash: string,
): Promise<JoinAttemptDto> {
  return apiRequest("/invites/resolve", { method: "POST", body: { token, browserBindingHash } });
}

export function acceptInvite(attemptId: string, consentVersion: string): Promise<JoinAttemptDto> {
  return apiRequest(`/invites/${attemptId}/accept`, { method: "POST", body: { consentVersion } });
}

// --- Catalog (POST /api/v1/catalog/products, GET /catalog/lookup) ------------

export function createProduct(input: {
  canonicalName: string;
  brand?: string | null;
  defaultUnit: ProductUnit;
}): Promise<ProductDto> {
  return apiRequest("/catalog/products", {
    method: "POST",
    body: { ...input, brand: input.brand ?? undefined },
  });
}

// --- Inventory (GET/POST /api/v1/inventory/stock-items, POST .../movements) --

export function listStockItems(familyId: string): Promise<{ items: StockItemDto[] }> {
  return apiRequest("/inventory/stock-items", { query: { familyId } });
}

export function createStockItem(input: {
  familyId: string;
  productId: string;
  packageId?: string;
  locationId?: string;
  quantity: number;
  unit: InventoryUnit;
  reorderPoint?: number;
}): Promise<StockItemDto> {
  return apiRequest("/inventory/stock-items", { method: "POST", body: input });
}

export function recordMovement(
  stockItemId: string,
  version: number,
  input: {
    familyId: string;
    kind: MovementKind;
    quantity: number;
    unit: InventoryUnit;
    occurredAt: string;
  },
): Promise<RecordMovementResultDto> {
  return apiRequest(`/inventory/stock-items/${stockItemId}/movements`, {
    method: "POST",
    ifMatch: version,
    body: { ...input, source: "web-app", clientOperationId: newIdempotencyKey() },
  });
}

// --- Shopping (GET .../lists/active, POST .../lists, POST .../lists/{id}/items) --

export function getActiveShoppingList(familyId: string): Promise<ActiveShoppingListDto> {
  return apiRequest("/shopping/lists/active", { query: { familyId } });
}

export function createShoppingList(familyId: string, name: string): Promise<{
  id: string;
  familyId: string;
  ownerUserId: string;
  name: string;
  status: "ACTIVE";
  version: number;
}> {
  return apiRequest("/shopping/lists", { method: "POST", body: { familyId, name } });
}

export function addShoppingItem(
  familyId: string,
  listId: string,
  input: {
    displayName: string;
    quantity: number;
    unit: InventoryUnit;
    productId?: string;
    sourceType: ShoppingSourceType;
    sourceRef?: string;
  },
): Promise<AddShoppingItemResultDto> {
  return apiRequest(`/shopping/lists/${listId}/items`, {
    method: "POST",
    body: { familyId, ...input },
  });
}
