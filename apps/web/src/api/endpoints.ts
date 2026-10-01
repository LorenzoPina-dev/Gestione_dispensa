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
  BarcodeResolutionDto,
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
  MovementDto,
  NotificationDto,
  RecipeDto,
  RecipeMatchDto,
  NutritionSummaryDto,
} from "./types";

// --- Platform ----------------------------------------------------------------

export function getReadiness(): Promise<ReadinessDto> {
  return apiRequest<ReadinessDto>("/health/ready");
}

// --- Auth / Identity ---------------------------------------------------------

export function getCurrentUser(): Promise<UserDto> {
  return apiRequest<UserDto>("/identity/me");
}

export function logoutSession(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export async function getFamily(): Promise<{ id: string; displayName: string } | null> {
  const result = await listFamilies();
  const firstFamily = result.families[0];

  return firstFamily
    ? {
        id: firstFamily.familyId,
        displayName: firstFamily.displayName,
      }
    : null;
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
  // The family-service HTTP contract expects `name`, while the web domain
  // uses `displayName`. Translate the field only at the transport boundary.
  return apiRequest<FamilyCreationResultDto>("/families", {
    method: "POST",
    body: { name: input.displayName },
  });
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

interface FamiliesHttpResponse {
  items?: UserFamilySummaryDto[];
  nextCursor?: string | null;
  /** Legacy response shape accepted during the contract transition. */
  families?: UserFamilySummaryDto[];
}

export interface FamiliesResult {
  families: UserFamilySummaryDto[];
  nextCursor: string | null;
}

/**
 * Normalizes the actual family-service response.
 *
 * Current backend contract:
 *   { items: UserFamilySummaryDto[], nextCursor: string | null }
 *
 * The web domain historically consumed:
 *   { families: UserFamilySummaryDto[] }
 *
 * Keeping this adapter at the HTTP boundary prevents every page/hook from
 * having to know about the transport-level pagination shape.
 */
export async function listFamilies(): Promise<FamiliesResult> {
  const result = await apiRequest<FamiliesHttpResponse>("/families");

  const families = (Array.isArray(result.items) ? result.items : Array.isArray(result.families) ? result.families : []).map((family) => ({ ...family, displayName: family.displayName ?? family.name }));

  return {
    families,
    nextCursor: result.nextCursor ?? null,
  };
}

export async function listFamilyMembers(familyId: string): Promise<{ memberships: ManagedMembershipDto[] }> {
  const result = await apiRequest<{ items: Array<{ userId: string; role: "owner" | "admin" | "member" | "viewer"; joinedAt: string }>; nextCursor: string | null }>(`/families/${familyId}/members`);
  return {
    memberships: result.items.map((member) => ({
      id: member.userId,
      familyId,
      userId: member.userId,
      role:
        member.role === "owner"
          ? "OWNER"
          : member.role === "admin"
            ? "MANAGER"
            : member.role === "viewer"
              ? "VIEWER"
              : "MEMBER",
      status: "ACTIVE",
      version: 1,
      joinedAt: member.joinedAt,
    })),
  };
}

export function updateFamilyMembership(
  familyId: string,
  membershipId: string,
  input: { role: MembershipRole | "ADMIN"; status: "ACTIVE" | "SUSPENDED" },
): Promise<ManagedMembershipDto> {
  return apiRequest(`/families/${familyId}/members/${membershipId}`, { method: "PATCH", body: { role: input.role.toLowerCase() } });
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
  category?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}): Promise<ProductDto> {
  return apiRequest("/catalog/products", {
    method: "POST",
    body: { name: input.canonicalName, brand: input.brand ?? undefined, defaultUnit: input.defaultUnit, ...(input.category ? { category: input.category } : {}) },
  });
}

// --- Inventory ---------------------------------------------------------------

export function listStockItems(familyId: string): Promise<{ items: StockItemDto[] }> {
  return apiRequest("/inventory", { query: { familyId, status: "current" } });
}

export function createStockItem(input: {
  familyId: string;
  productId: string;
  packageId?: string;
  locationId?: string;
  quantity: number;
  unit: InventoryUnit;
  reorderPoint?: number;
  location?: string;
  expiresAt?: string;
}): Promise<StockItemDto> {
  return apiRequest("/inventory/items", { method: "POST", body: { productId: input.productId, quantity: input.quantity, unit: input.unit, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), ...(input.location ? { location: input.location } : {}), ...(input.packageId ? { lotCode: input.packageId } : {}) } });
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
  const path = input.kind === "WASTE" ? `/inventory/${stockItemId}/waste` : `/inventory/${stockItemId}/consume`;
  return apiRequest(path, {
    method: "POST",
    ifMatch: version,
    body: { quantity: input.quantity, reason: input.kind === "WASTE" ? "spoiled" : "used" },
  });
}

// --- Shopping ----------------------------------------------------------------

export function getActiveShoppingList(familyId: string): Promise<ActiveShoppingListDto> {
  const result = await apiRequest<{ items: Array<{ listId: string; name: string; status: string; itemCount: number; version: number }>; nextCursor: string | null }>("/shopping/lists", { query: { familyId } });
  const active = result.items.find((item) => item.status === "open");
  if (!active) {
    throw new ApiError(404, {
      error: { code: "NOT_FOUND", message: "No active shopping list exists.", retryable: false },
      meta: { requestId: "", traceId: "", schemaVersion: "2.0" },
    });
  }
  return apiRequest<ActiveShoppingListDto>(`/shopping/lists/${active.listId}`);
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
    body: { familyId, label: input.displayName, quantity: input.quantity, unit: input.unit, ...(input.productId ? { productId: input.productId } : {}) },
  });
}

export function updateShoppingItemState(
  familyId: string,
  listId: string,
  itemId: string,
  version: number,
  state: ShoppingItemState,
): Promise<ShoppingItemDto> {
  return apiRequest(`/shopping/lists/${listId}/items/${itemId}`, {
    method: "PATCH",
    ifMatch: version,
    body: { checked: state === "ACCEPTED" || state === "COMPLETED" },
  });
}

export function batchUpdateShoppingItems(
  familyId: string,
  listId: string,
  itemIds: string[],
  state: ShoppingItemState,
): Promise<{ updated: ShoppingItemDto[]; failedItemIds: string[] }> {
  const updated: ShoppingItemDto[] = [];
  const failedItemIds: string[] = [];
  for (const itemId of itemIds) {
    try {
      updated.push(await updateShoppingItemState(familyId, listId, itemId, 0, state));
    } catch {
      failedItemIds.push(itemId);
    }
  }
  return { updated, failedItemIds };
}

// --- Notifications ----------------------------------------------------------

export async function listNotifications(familyId: string): Promise<{ notifications: NotificationDto[] }> {
  const result = await apiRequest<{ items: NotificationDto[]; nextCursor: string | null }>("/notifications", { query: { familyId } });
  return { notifications: result.items };
}

export function markNotificationRead(
  familyId: string,
  notificationId: string,
): Promise<NotificationDto> {
  return apiRequest(`/notifications/${notificationId}/read`, {
    method: "POST",
    body: { familyId },
  });
}

// --- Inventory history / dashboard ------------------------------------------

export function listMovements(stockItemId: string): Promise<{ movements: MovementDto[] }> {
  return apiRequest(`/inventory/${stockItemId}/movements`);
}

// --- Recipes -----------------------------------------------------------------

export async function listRecipes(familyId: string): Promise<{ recipes: RecipeDto[] }> {
  const result = await apiRequest<{ items: RecipeDto[]; nextCursor: string | null }>("/recipes", { query: { familyId } });
  return { recipes: result.items };
}

export async function listRecipeSuggestions(familyId: string): Promise<{ suggestions: RecipeMatchDto[] }> {
  const result = await apiRequest<{ items: RecipeMatchDto[]; nextCursor?: string | null }>("/recipes/suggestions", { query: { familyId } });
  return { suggestions: result.items };
}

export async function getRecipe(familyId: string, recipeId: string): Promise<{ recipe: RecipeDto }> {
  const result = await apiRequest<{ data: RecipeDto }>(`/recipes/${recipeId}`, { query: { familyId } });
  return { recipe: result.data };
}

export function addRecipeMissingIngredients(
  familyId: string,
  recipeId: string,
): Promise<{ itemIds: string[] }> {
  return apiRequest(`/recipes/${recipeId}/add-missing`, {
    method: "POST",
    body: { familyId },
  });
}

export function cookRecipe(
  familyId: string,
  recipeId: string,
  servings: number,
): Promise<{ movementIds: string[] }> {
  return apiRequest(`/recipes/${recipeId}/cook`, {
    method: "POST",
    body: { familyId, servings },
  });
}

// --- Nutrition ---------------------------------------------------------------

export async function getNutritionSummary(
  familyId: string,
  period: "today" | "week" = "today",
): Promise<NutritionSummaryDto> {
  const result = await apiRequest<{ data: NutritionSummaryDto }>("/nutrition/summary", { query: { familyId, period } });
  return result.data;
}

export async function listFamilyInvites(familyId: string): Promise<{ invites: Array<{ id?: string; inviteId?: string; role: InviteRole; status: "CREATED"|"REVOKED"|"CONSUMED"|"EXPIRED"; expiresAt: string; fallbackCode?: string; createdAt: string }> }> {
  const result = await apiRequest<{ items: Array<{ inviteId: string; role: "admin"|"member"; status: string; expiresAt: string; createdAt: string }>; nextCursor: string | null }>(`/families/${familyId}/invites`);
  return { invites: result.items.map((i) => ({
    inviteId: i.inviteId,
    role: i.role === "admin" ? "MANAGER" : "MEMBER",
    status: i.status === "pending" ? "CREATED" : i.status === "revoked" ? "REVOKED" : i.status === "accepted" ? "CONSUMED" : "EXPIRED",
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
  })) };
}

export function requestPasswordReset(email: string): Promise<{ accepted: boolean; message: string }> {
  return apiRequest("/auth/reset-password", { method: "POST", body: { email } });
}

export function resolveProductBarcode(
  identifierType: "EAN8" | "EAN13" | "GTIN12" | "GTIN14" | "SKU" | "BARCODE",
  value: string,
): Promise<BarcodeResolutionDto> {
  return apiRequest("/catalog/barcodes/resolve", { method: "POST", body: { barcode: value } });
}
