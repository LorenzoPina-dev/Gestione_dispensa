import { apiRequest, ApiError, newIdempotencyKey } from "./client";
import type { ActiveShoppingListDto, AcceptInviteResultDto, CreatedInviteDto, FamilyCreationResultDto, InventoryUnit, JoinAttemptDto, ManagedMembershipDto, MembershipRole, MovementKind, ProductDto, ProductImagesDto, ProductUnit, ProductSearchResultDto, ReadinessDto, ShoppingItemDto, ShoppingItemState, ShoppingSourceType, StockItemDto, RecordMovementResultDto, InviteRole, UserFamilySummaryDto, UserDto, MovementDto, NotificationDto, RecipeDto, RecipeMatchDto, NutritionSummaryDto, BarcodeResolutionDto, StoreDto, StoreOfferDto, CatalogProductRefDto, ReorderSuggestionDto } from "./types";
import { isUuid, shoppingSourceToApi } from "./mappers";

export function getReadiness(): Promise<ReadinessDto> { return apiRequest<ReadinessDto>("/health/ready"); }
export interface CurrentUserDto extends UserDto {
  id: string;
  name: string | null;
  preferredUsername: string | null;
  activeFamilyId?: string | null;
  roles?: string[];
}

export async function getCurrentUser(): Promise<CurrentUserDto> {
  const user = await apiRequest<UserDto>("/identity/me");
  return {
    ...user,
    id: user.userId,
    name: user.displayName ?? null,
    preferredUsername: user.displayName ?? null,
    activeFamilyId: null,
    roles: [],
  };
}
export function logoutSession(): Promise<void> { return apiRequest<void>("/auth/logout", { method: "POST" }); }
export async function getFamily(): Promise<{ id: string; displayName: string } | null> { const f = (await listFamilies()).families[0]; return f ? { id: f.familyId, displayName: f.displayName ?? f.name } : null; }
export interface RegisterPayload { name: string; email: string; password: string; }
export function registerUser(payload: RegisterPayload): Promise<{ success: boolean; message: string }> { return apiRequest("/auth/register", { method: "POST", body: payload }); }
export function createFamily(name: string): Promise<FamilyCreationResultDto> {
  const familyName = name.trim();
  if (!familyName) throw new Error("Family name is required.");
  return apiRequest<FamilyCreationResultDto>("/families", { method: "POST", body: { name: familyName } });
}
export async function listFamilyInvites(familyId: string): Promise<{ invites: Array<{ id: string; inviteId: string; role: InviteRole; status: "CREATED"|"REVOKED"|"CONSUMED"|"EXPIRED"; expiresAt: string; fallbackCode?: string; qrPayload?: string; createdAt: string; version: number }> }> {
  const result = await apiRequest<{ items: Array<{ inviteId: string; email?: string; role: "admin"|"member"|"viewer"; status: string; expiresAt: string; createdAt: string; version: number }>; nextCursor: string | null }>(`/families/${familyId}/invites`);
  return {
    invites: result.items.map((item) => ({
      id: item.inviteId,
      inviteId: item.inviteId,
      role: item.role === "admin" ? "MANAGER" : item.role === "viewer" ? "VIEWER" : "MEMBER",
      status: item.status === "pending" ? "CREATED" : item.status === "revoked" ? "REVOKED" : item.status === "accepted" ? "CONSUMED" : "EXPIRED",
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      version: item.version,
    })),
  };
}
export async function createFamilyInvite(familyId: string, input: { role: InviteRole; expiresInSeconds: number }): Promise<CreatedInviteDto> {
  const result = await apiRequest<{
    inviteId: string;
    email?: string;
    role: "admin" | "member" | "viewer";
    status: string;
    expiresAt: string;
    fallbackCode?: string;
    qrPayload?: string;
  }>(`/families/${familyId}/invites`, { method: "POST", body: {
    role: input.role === "MANAGER" ? "admin" : input.role === "VIEWER" ? "viewer" : "member",
    expiresInSeconds: input.expiresInSeconds,
  } });
  return {
    inviteId: result.inviteId,
    email: result.email,
    role: result.role === "admin" ? "MANAGER" : result.role === "viewer" ? "VIEWER" : "MEMBER",
    status: result.status === "pending" ? "CREATED" : "CREATED",
    expiresAt: result.expiresAt,
    fallbackCode: result.fallbackCode,
    qrPayload: result.qrPayload,
  };
}
export function resolveInvite(token: string, browserBindingHash: string): Promise<JoinAttemptDto> { return apiRequest("/family-invites/resolve", { method: "POST", body: { token, browserBindingHash } }); }
export function resolveInviteByCode(code: string, browserBindingHash: string): Promise<JoinAttemptDto> { return apiRequest("/family-invites/resolve-code", { method: "POST", body: { code, browserBindingHash } }); }
export async function acceptInvite(attemptId: string, consentVersion: string): Promise<AcceptInviteResultDto> {
  const result = await apiRequest<{
    familyId: string;
    userId: string;
    role: "admin" | "member" | "viewer";
    joinedAt: string;
    version: number;
  }>(`/invites/${attemptId}/accept`, { method: "POST", body: { consentVersion } });
  return {
    familyId: result.familyId,
    userId: result.userId,
    role: result.role === "admin" ? "MANAGER" : result.role === "viewer" ? "VIEWER" : "MEMBER",
    joinedAt: result.joinedAt,
    version: result.version,
  };
}
interface FamiliesHttpResponse { items?: UserFamilySummaryDto[]; nextCursor?: string | null; }
export interface FamiliesResult { families: UserFamilySummaryDto[]; nextCursor: string | null; }
export async function listFamilies(): Promise<FamiliesResult> { const result = await apiRequest<FamiliesHttpResponse>("/families"); return { families: (result.items ?? []).map((f) => ({ ...f, displayName: f.name })), nextCursor: result.nextCursor ?? null }; }
export async function listFamilyMembers(familyId: string): Promise<{ memberships: ManagedMembershipDto[] }> { const result = await apiRequest<{ items: Array<{ userId: string; role: "owner" | "admin" | "member" | "viewer"; joinedAt: string; version: number; status: "ACTIVE" | "SUSPENDED" | "REMOVED" }>; nextCursor: string | null }>(`/families/${familyId}/members`); return { memberships: result.items.map((m) => ({ id: m.userId, familyId, userId: m.userId, role: m.role === "owner" ? "OWNER" : m.role === "admin" ? "MANAGER" : m.role === "viewer" ? "VIEWER" : "MEMBER", status: m.status, version: m.version, joinedAt: m.joinedAt })) }; }
export function updateFamilyMembership(familyId: string, membershipId: string, version: number, input: { role: MembershipRole | "ADMIN"; status?: "ACTIVE" | "SUSPENDED" }): Promise<ManagedMembershipDto> { return apiRequest(`/families/${familyId}/members/${membershipId}`, { method: "PATCH", ifMatch: version, query: { familyId }, body: { role: input.role === "ADMIN" || input.role === "MANAGER" ? "admin" : input.role.toLowerCase(), ...(input.status ? { status: input.status } : {}) } }); }
export async function removeFamilyMembership(familyId: string, membershipId: string, version: number): Promise<void> { await apiRequest<void>(`/families/${familyId}/members/${membershipId}`, { method: "DELETE", ifMatch: version, query: { familyId } }); }
export async function createProduct(input: {
  canonicalName: string;
  brand?: string | null;
  defaultUnit?: ProductUnit;
  category?: string;
  barcodes?: string[];
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  idempotencyKey?: string;
}): Promise<ProductDto> {
  const r = await apiRequest<any>("/catalog/products", {
    method: "POST",
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    body: {
      name: input.canonicalName,
      ...(input.defaultUnit ? { defaultUnit: input.defaultUnit } : {}),
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.barcodes?.length ? { barcodes: input.barcodes } : {}),
      ...(input.calories !== undefined ? { calories: input.calories } : {}),
      ...(input.protein !== undefined ? { protein: input.protein } : {}),
      ...(input.carbs !== undefined ? { carbs: input.carbs } : {}),
      ...(input.fat !== undefined ? { fat: input.fat } : {}),
      ...(input.fiber !== undefined ? { fiber: input.fiber } : {}),
    },
  });
  return {
    id: r.productId,
    canonicalName: r.name,
    brand: r.brand ?? undefined,
    defaultUnit: input.defaultUnit ?? "piece",
    status: "ACTIVE",
    provenanceQuality: r.source.type === "manual" ? "VERIFIED" : "IMPORTED",
    version: r.version,
    category: r.category ?? undefined,
    photoUrl: r.imageObjectKey ?? undefined,
    calories: r.nutrition.kcalPer100g ?? undefined,
    protein: r.nutrition.proteinGPer100g ?? undefined,
    carbs: r.nutrition.carbsGPer100g ?? undefined,
    fat: r.nutrition.fatGPer100g ?? undefined,
    fiber: r.nutrition.fiberGPer100g ?? undefined,
    createdAt: "",
    updatedAt: "",
  };
}
export function listStockItems(familyId: string): Promise<{ items: StockItemDto[] }> { return apiRequest("/inventory", { query: { familyId, status: "current" } }); }
export function createStockItem(input: { familyId: string; productId: string; packageId?: string; locationId?: string; quantity: number; unit: InventoryUnit; reorderPoint?: number; reorderQuantity?: number; location?: string; expiresAt?: string; idempotencyKey?: string }): Promise<StockItemDto> { return apiRequest("/inventory/items", { method: "POST", idempotencyKey: input.idempotencyKey, query: { familyId: input.familyId }, body: { productId: input.productId, quantity: input.quantity, unit: input.unit, ...(input.reorderPoint != null ? { reorderPoint: input.reorderPoint } : {}), ...(input.reorderQuantity != null ? { reorderQuantity: input.reorderQuantity } : {}), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), ...(input.location ? { location: input.location } : {}), ...(input.packageId ? { lotCode: input.packageId } : {}) } }); }
export async function listReorderSuggestions(familyId: string): Promise<{ suggestions: ReorderSuggestionDto[] }> {
  const r = await apiRequest<{ items: ReorderSuggestionDto[]; nextCursor: string | null }>("/shopping/suggestions", { query: { familyId, status: "active" } });
  return { suggestions: r.items };
}
export function recordMovement(stockItemId: string, version: number, input: { familyId: string; kind: MovementKind; quantity: number; unit: InventoryUnit; occurredAt: string; idempotencyKey?: string }): Promise<RecordMovementResultDto> { const path = input.kind === "WASTE" ? `/inventory/${stockItemId}/waste` : `/inventory/${stockItemId}/consume`; return apiRequest(path, { method: "POST", idempotencyKey: input.idempotencyKey, ifMatch: version, query: { familyId: input.familyId }, body: { quantity: input.quantity, reason: input.kind === "WASTE" ? "spoiled" : "used" } }); }
export async function getActiveShoppingList(familyId: string): Promise<ActiveShoppingListDto> { const r = await apiRequest<{ items: Array<{ listId: string; name: string; status: string; itemCount: number; version: number }>; nextCursor: string | null }>("/shopping/lists", { query: { familyId } }); const a = r.items.find((i) => i.status === "open"); if (!a) throw new ApiError(404, { error: { code: "NOT_FOUND", message: "No active shopping list exists.", retryable: false }, meta: { requestId: "", traceId: "", schemaVersion: "2.0" } }); const d = await apiRequest<{ listId: string; name: string; status: "open" | "closed" | "archived"; items: ShoppingItemDto[]; version: number }>(`/shopping/lists/${a.listId}`, { query: { familyId } }); return { list: { listId: d.listId, name: d.name, status: d.status, version: d.version }, items: d.items }; }
export async function createShoppingList(familyId: string, name: string): Promise<{ id: string; familyId: string; ownerUserId: string; name: string; status: "ACTIVE" | "ARCHIVED"; version: number }> { const r = await apiRequest<{ listId: string; name: string; status: "open" | "closed" | "archived"; version: number }>("/shopping/lists", { method: "POST", body: { familyId, name } }); return { id: r.listId, familyId, ownerUserId: "", name: r.name, status: r.status === "open" ? "ACTIVE" : "ARCHIVED", version: r.version }; }
export function addShoppingItem(familyId: string, listId: string, input: { displayName: string; quantity: number; unit: InventoryUnit; productId?: string; sourceType: ShoppingSourceType; sourceRef?: string; idempotencyKey?: string }): Promise<ShoppingItemDto> {
  return apiRequest(`/shopping/lists/${listId}/items`, {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      familyId,
      label: input.displayName,
      quantity: input.quantity,
      unit: input.unit,
      source: shoppingSourceToApi(input.sourceType),
      ...(input.productId && isUuid(input.productId) ? { productId: input.productId } : {}),
    },
  });
}
export interface ShoppingItemPatch { label?: string; quantity?: number; unit?: InventoryUnit; checked?: boolean; }
export function updateShoppingItem(familyId: string, listId: string, itemId: string, version: number, patch: ShoppingItemPatch, idempotencyKey?: string): Promise<ShoppingItemDto> { return apiRequest(`/shopping/lists/${listId}/items/${itemId}`, { method: "PATCH", ifMatch: version, idempotencyKey, query: { familyId }, body: patch }); }
// Shopping persists one flag: only COMPLETED (in the cart) is checked. ACCEPTED means still to buy.
export function updateShoppingItemState(familyId: string, listId: string, itemId: string, version: number, state: ShoppingItemState, idempotencyKey?: string): Promise<ShoppingItemDto> { return updateShoppingItem(familyId, listId, itemId, version, { checked: state === "COMPLETED" }, idempotencyKey); }
export async function batchUpdateShoppingItems(familyId: string, listId: string, items: Array<{ itemId: string; version: number }>, state: ShoppingItemState): Promise<{ updated: ShoppingItemDto[]; failedItemIds: string[] }> { const updated: ShoppingItemDto[] = []; const failedItemIds: string[] = []; for (const i of items) { try { updated.push(await updateShoppingItemState(familyId, listId, i.itemId, i.version, state, `shopping-state:${i.itemId}:${i.version}:${state}`)); } catch { failedItemIds.push(i.itemId); } } return { updated, failedItemIds }; }
export function deleteShoppingItem(familyId: string, listId: string, itemId: string, version: number, idempotencyKey?: string): Promise<void> { return apiRequest<void>(`/shopping/lists/${listId}/items/${itemId}`, { method: "DELETE", idempotencyKey, query: { familyId }, ifMatch: version }); }
export async function listNotifications(familyId: string): Promise<{ notifications: NotificationDto[] }> { const r = await apiRequest<{ items: NotificationDto[]; nextCursor: string | null }>("/notifications", { query: { familyId } }); return { notifications: r.items }; }
export function markNotificationRead(familyId: string, notificationId: string): Promise<NotificationDto> { return apiRequest(`/notifications/${notificationId}/read`, { method: "POST", body: { familyId } }); }
export async function createOcrJob(input: { familyId: string; type: "receipt" | "pantry_image"; file: File }): Promise<{ jobId: string; status: string; type: string; objectKey: string }> { const f = new FormData(); f.set("familyId", input.familyId); f.set("type", input.type); f.set("file", input.file, input.file.name); return apiRequest("/ocr/jobs", { method: "POST", body: f }); }
export async function listOcrJobs(familyId: string, status?: string): Promise<any> { return apiRequest("/ocr/jobs", { query: { familyId, ...(status ? { status } : {}) } }); }
export async function getOcrJob(jobId: string): Promise<any> { return apiRequest(`/ocr/jobs/${jobId}`); }
export async function getOcrDraft(draftId: string): Promise<any> { return apiRequest(`/ocr/drafts/${draftId}`); }
export function rejectOcrDraft(draftId: string): Promise<any> { return apiRequest(`/ocr/drafts/${draftId}/reject`, { method: "POST", body: {} }); }
export function confirmOcrDraft(draftId: string, items: Array<{ name: string; productId?: string | null; quantity: number; unit: string; priceMinor?: number | null; currency?: string | null }>): Promise<any> { return apiRequest(`/ocr/drafts/${draftId}/confirm`, { method: "POST", body: { items } }); }
export function listMovements(familyId: string, stockItemId: string): Promise<{ movements: MovementDto[] }> { return apiRequest(`/inventory/${stockItemId}/movements`, { query: { familyId } }); }
export async function listRecipes(familyId: string): Promise<{ recipes: RecipeDto[] }> { const r = await apiRequest<{ items: RecipeDto[]; nextCursor: string | null }>("/recipes", { query: { familyId } }); return { recipes: r.items }; }
export async function listRecipeSuggestions(familyId: string): Promise<{ suggestions: RecipeMatchDto[] }> { const r = await apiRequest<{ items: RecipeMatchDto[]; nextCursor?: string | null }>("/recipes/suggestions", { query: { familyId } }); return { suggestions: r.items }; }
export async function getRecipe(familyId: string, recipeId: string): Promise<{ recipe: RecipeDto }> { return { recipe: await apiRequest<RecipeDto>(`/recipes/${recipeId}`, { query: { familyId } }) }; }


type CatalogBarcodeProductDto = {
  productId: string;
  name: string;
  brand: string | null;
  category: string | null;
  barcodes: string[];
  imageObjectKey: string | null;
  nutrition: {
    kcalPer100g: number | null;
    proteinGPer100g: number | null;
    carbsGPer100g: number | null;
    fatGPer100g: number | null;
    fiberGPer100g: number | null;
  };
  package: {
    value: number | null;
    unit: string | null;
    label: string | null;
  };
  serving: {
    size: string | null;
    quantity: number | null;
    unit: string | null;
  };
  images: ProductImagesDto;
  openFoodFacts: Record<string, unknown> | null;
  source: { type: string; id: string };
  version: number;
};

function isProductUnit(value: string | null | undefined): value is ProductUnit {
  return value === "g" || value === "kg" || value === "ml" || value === "l" || value === "piece" || value === "pack";
}

function mapCatalogBarcodeProduct(p: CatalogBarcodeProductDto): ProductDto {
  return {
    id: p.productId,
    canonicalName: p.name.trim() || `Prodotto ${p.productId.slice(0, 8)}`,
    ...(p.brand ? { brand: p.brand } : {}),
    defaultUnit: isProductUnit(p.package.unit) ? p.package.unit : "piece",
    status: "ACTIVE",
    provenanceQuality: p.source.type === "manual" ? "VERIFIED" : "IMPORTED",
    version: p.version,
    ...(p.category ? { category: p.category } : {}),
    ...(p.imageObjectKey ? { photoUrl: p.imageObjectKey } : {}),
    ...(p.nutrition.kcalPer100g != null ? { calories: p.nutrition.kcalPer100g } : {}),
    ...(p.nutrition.proteinGPer100g != null ? { protein: p.nutrition.proteinGPer100g } : {}),
    ...(p.nutrition.carbsGPer100g != null ? { carbs: p.nutrition.carbsGPer100g } : {}),
    ...(p.nutrition.fatGPer100g != null ? { fat: p.nutrition.fatGPer100g } : {}),
    ...(p.nutrition.fiberGPer100g != null ? { fiber: p.nutrition.fiberGPer100g } : {}),
    ...(p.package.value != null ? { quantityValue: p.package.value } : {}),
    ...(p.package.unit ? { quantityUnit: p.package.unit } : {}),
    ...(p.package.label ? { quantityLabel: p.package.label } : {}),
    ...(p.serving.size ? { servingSize: p.serving.size } : {}),
    ...(p.serving.quantity != null ? { servingQuantity: p.serving.quantity } : {}),
    ...(p.serving.unit ? { servingUnit: p.serving.unit } : {}),
    ...(p.images ? { images: p.images } : {}),
    ...(p.openFoodFacts ? { openFoodFacts: p.openFoodFacts } : {}),
    createdAt: "",
    updatedAt: "",
  };
}

export function searchCatalogProducts(query: string, limit = 8, signal?: AbortSignal): Promise<{ items: ProductSearchResultDto[] }> {
  return apiRequest<{ items: ProductSearchResultDto[] }>("/catalog/products/search", {
    query: {
      q: query.trim(),
      limit: Math.min(Math.max(Math.floor(limit), 1), 20),
    },
    signal,
  });
}

export async function resolveProductBarcode(
  identifierType: string,
  value: string,
  refresh = false,
): Promise<BarcodeResolutionDto> {
  try {
    const normalizedValue = value.trim();
    if (identifierType !== "BARCODE") {
      throw new ApiError(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Only BARCODE resolution is supported by this endpoint.",
          retryable: false,
        },
        meta: { requestId: "", traceId: "", schemaVersion: "1.0" },
      });
    }
    const result = await apiRequest<{ resolution: "cache" | "provider"; product: CatalogBarcodeProductDto }>(
      "/catalog/barcodes/resolve",
      {
        method: "POST",
        body: { barcode: normalizedValue },
      },
    );
    return {
      status: "MATCHED",
      identifierType,
      normalizedValue,
      product: mapCatalogBarcodeProduct(result.product),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "UNKNOWN", identifierType, normalizedValue: value.trim() };
    }
    if (error instanceof ApiError && (error.status === 502 || error.code === "UPSTREAM_ERROR")) {
      return { status: "DEGRADED", identifierType, normalizedValue: value.trim() };
    }
    throw error;
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest<{ accepted: boolean; message: string }>("/auth/reset-password", {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
  });
}

export async function getNutritionSummary(
  familyId: string,
  period: "today" | "week" = "today",
): Promise<NutritionSummaryDto> {
  return apiRequest<NutritionSummaryDto>("/nutrition/summary", {
    query: { familyId, period },
  });
}

export async function addRecipeMissingIngredients(
  familyId: string,
  recipeId: string,
): Promise<{ itemIds: string[] }> {
  return apiRequest<{ itemIds: string[] }>(`/recipes/${recipeId}/add-missing`, {
    method: "POST",
    body: { familyId },
  });
}

export async function listStores(query?: string, limit = 10, signal?: AbortSignal): Promise<{ stores: StoreDto[] }> {
  const r = await apiRequest<{ items: StoreDto[]; nextCursor: string | null }>("/stores", { query: { q: query?.trim() || undefined, limit }, signal });
  return { stores: r.items };
}

export async function listStoreOffers(storeId: string, limit = 20, signal?: AbortSignal): Promise<{ offers: StoreOfferDto[] }> {
  const r = await apiRequest<{ items: StoreOfferDto[]; nextCursor: string | null }>(`/stores/${storeId}/offers`, { query: { active: "true", limit }, signal });
  return { offers: r.items };
}

export function getCatalogProduct(productId: string, signal?: AbortSignal): Promise<CatalogProductRefDto> {
  return apiRequest<CatalogProductRefDto>(`/catalog/products/${productId}`, { signal });
}

export async function getCatalogProductsBatch(productIds: string[], signal?: AbortSignal): Promise<CatalogProductRefDto[]> {
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return [];
  const result = await apiRequest<{ items: CatalogProductRefDto[] }>("/catalog/products/batch", {
    method: "POST",
    body: { ids },
    signal,
  });
  return result.items ?? [];
}
