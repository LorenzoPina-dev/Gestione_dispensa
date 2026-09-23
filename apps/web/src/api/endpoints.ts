import { apiRequest, newIdempotencyKey } from "./client";
import type {
  ActiveShoppingListDto,
  AddShoppingItemResultDto,
  CreatedInviteDto,
  FamilyCreationResultDto,
  InventoryUnit,
  JoinAttemptDto,
  ManagedMembershipDto,
  MembershipRole,
  MovementKind,
  ProductDto,
  ProductUnit,
  ReadinessDto,
  ShoppingItemDto,
  ShoppingItemState,
  ShoppingSourceType,
  StockItemDto,
  RecordMovementResultDto,
  InviteRole,
  UserFamilySummaryDto,
  UserDto,
} from "./types";

// --- Platform ----------------------------------------------------------------

export function getReadiness(): Promise<ReadinessDto> {
  return apiRequest<ReadinessDto>("/health/ready");
}

// --- Auth / Identity ---------------------------------------------------------

export function getCurrentUser(): Promise<UserDto> {
  return apiRequest<UserDto>("/auth/me");
}

export function logoutSession(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export async function getFamily(): Promise<{ id: string; displayName: string } | null> {
  const result = await listFamilies();
  if (result.families && result.families.length > 0) {
    return {
      id: result.families[0].familyId,
      displayName: result.families[0].displayName,
    };
  }
  return null;
}

// Integrazione nella sezione Auth / Identity

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export function registerUser(payload: RegisterPayload): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>("/auth/register", {
    method: "POST",
    body: payload,
  });
}

// --- Family ------------------------------------------------------------------

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
  return apiRequest("/family-invites/resolve", { method: "POST", body: { token, browserBindingHash } });
}

export function resolveInviteByCode(
  code: string,
  browserBindingHash: string,
): Promise<JoinAttemptDto> {
  return apiRequest("/family-invites/resolve-code", { method: "POST", body: { code, browserBindingHash } });
}

export function acceptInvite(attemptId: string, consentVersion: string): Promise<JoinAttemptDto> {
  return apiRequest(`/invites/${attemptId}/accept`, { method: "POST", body: { consentVersion } });
}

export function listFamilies(): Promise<{ families: UserFamilySummaryDto[] }> {
  return apiRequest("/families");
}

export function listFamilyMembers(familyId: string): Promise<{ memberships: ManagedMembershipDto[] }> {
  return apiRequest(`/families/${familyId}/members`);
}

export function updateFamilyMembership(
  familyId: string,
  membershipId: string,
  input: { role: MembershipRole | "ADMIN"; status: "ACTIVE" | "SUSPENDED" },
): Promise<ManagedMembershipDto> {
  return apiRequest(`/families/${familyId}/members/${membershipId}`, { method: "PATCH", body: input });
}

export function removeFamilyMembership(
  familyId: string,
  membershipId: string,
): Promise<ManagedMembershipDto> {
  return apiRequest(`/families/${familyId}/members/${membershipId}`, { method: "DELETE" });
}

// --- Catalog -----------------------------------------------------------------

export function createProduct(input: {
  canonicalName: string;
  brand?: string | null;
  defaultUnit: ProductUnit;
}): Promise<ProductDto> {
  return apiRequest("/products", {
    method: "POST",
    body: { ...input, brand: input.brand ?? undefined },
  });
}

// --- Inventory ---------------------------------------------------------------

export function listStockItems(familyId: string): Promise<{ items: StockItemDto[] }> {
  return apiRequest("/inventory/items", { query: { familyId } });
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
  return apiRequest("/inventory/items", { method: "POST", body: input });
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
  return apiRequest(`/inventory/items/${stockItemId}/movements`, {
    method: "POST",
    ifMatch: version,
    body: { ...input, source: "web-app", clientOperationId: newIdempotencyKey() },
  });
}

// --- Shopping ----------------------------------------------------------------

export function getActiveShoppingList(familyId: string): Promise<ActiveShoppingListDto> {
  return apiRequest("/shopping-lists/active", { query: { familyId } });
}

export function createShoppingList(familyId: string, name: string): Promise<{
  id: string;
  familyId: string;
  ownerUserId: string;
  name: string;
  status: "ACTIVE";
  version: number;
}> {
  return apiRequest("/shopping-lists", { method: "POST", body: { familyId, name } });
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
  return apiRequest(`/shopping-lists/${listId}/items`, {
    method: "POST",
    body: { familyId, ...input },
  });
}

export function updateShoppingItemState(
  familyId: string,
  listId: string,
  itemId: string,
  version: number,
  state: ShoppingItemState,
): Promise<ShoppingItemDto> {
  return apiRequest(`/shopping-lists/${listId}/items/${itemId}`, {
    method: "PATCH",
    ifMatch: version,
    body: { familyId, state },
  });
}

export function batchUpdateShoppingItems(
  familyId: string,
  listId: string,
  itemIds: string[],
  state: ShoppingItemState,
): Promise<{ updated: ShoppingItemDto[]; failedItemIds: string[] }> {
  return apiRequest(`/shopping-lists/${listId}/batch-action`, {
    method: "POST",
    body: { familyId, itemIds, state },
  });
}