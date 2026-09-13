/**
 * TypeScript mirror of the ACTUAL backend HTTP surface in apps/api/src/http.ts — not
 * docs/openapi.yaml, whose documented paths/shapes (`GET /inventory`, `/shopping-lists/active`,
 * PROPOSED/ACCEPTED states, etc.) turned out not to match the real, already-wired routes.
 * These types mirror the real domain `Product`/`StockItem`/`ShoppingItem`/... interfaces in
 * apps/api/src/{catalog,inventory,shopping,family}/service.ts and invites.ts.
 */

export interface Meta {
  requestId: string;
  traceId: string;
  schemaVersion: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  details?: Array<Record<string, unknown>>;
}

export interface ErrorEnvelope {
  error: ApiErrorBody;
  meta: Meta;
}

export interface Envelope<T> {
  data: T;
  meta: Meta;
}

// --- Family (apps/api/src/family/service.ts, invites.ts) --------------------

export type FamilyUnitSystem = "METRIC" | "IMPERIAL";

export interface FamilyDto {
  id: string;
  displayName: string;
  creatorUserId: string;
  locale: string;
  timezone: string;
  unitSystem: FamilyUnitSystem;
  status: "ACTIVE" | "SUSPENDED" | "ERASED";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyMembershipDto {
  id: string;
  familyId: string;
  userId: string;
  role: "OWNER";
  status: "ACTIVE";
  joinedAt: string;
  version: number;
}

export interface FamilyCreationResultDto {
  family: FamilyDto;
  membership: FamilyMembershipDto;
}

export type InviteRole = "MANAGER" | "MEMBER" | "VIEWER";

export interface CreatedInviteDto {
  inviteId: string;
  role: InviteRole;
  status: "CREATED";
  expiresAt: string;
  qrPayload: string;
  fallbackCode: string;
}

export interface JoinAttemptDto {
  id: string;
  inviteId: string;
  userId?: string;
  state: "PENDING_AUTHENTICATION" | "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  expiresAt: string;
}

// --- Catalog (apps/api/src/catalog/service.ts) -------------------------------

export type ProductUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";

export interface ProductDto {
  id: string;
  canonicalName: string;
  brand?: string;
  defaultUnit: ProductUnit;
  status: "ACTIVE";
  provenanceQuality: "VERIFIED";
  version: number;
  createdAt: string;
  updatedAt: string;
}

// --- Inventory (apps/api/src/inventory/service.ts) ---------------------------

export type InventoryUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
export type MovementKind = "RECEIPT" | "CONSUMPTION" | "WASTE" | "ADJUSTMENT" | "TRANSFER";

export interface StockItemDto {
  id: string;
  familyId: string;
  productId: string;
  quantity: number;
  unit: InventoryUnit;
  reorderPoint?: number;
  version: number;
  status: "ACTIVE";
}

export interface RecordMovementResultDto {
  stockItem: StockItemDto;
  movementId: string;
  duplicate: boolean;
}

// --- Shopping (apps/api/src/shopping/service.ts) -----------------------------

export type ShoppingItemState = "SUGGESTED" | "ACCEPTED" | "SNOOZED" | "IGNORED" | "COMPLETED";
export type ShoppingSourceType = "MANUAL" | "REORDER" | "OFFER" | "RECIPE";

export interface ShoppingListDto {
  id: string;
  familyId: string;
  ownerUserId: string;
  name: string;
  status: "ACTIVE";
  version: number;
}

export interface ShoppingItemDto {
  id: string;
  listId: string;
  productId?: string;
  displayName: string;
  quantity: number;
  unit: InventoryUnit;
  packageId?: string;
  state: ShoppingItemState;
  sourceType: ShoppingSourceType;
  sourceRef?: string;
  version: number;
}

export interface ActiveShoppingListDto {
  list: ShoppingListDto;
  items: ShoppingItemDto[];
}

export interface AddShoppingItemResultDto {
  item: ShoppingItemDto;
  merged: boolean;
}

// --- Platform -----------------------------------------------------------

export interface ReadinessDto {
  status: "ready";
  dependencies: Record<string, unknown>;
}
