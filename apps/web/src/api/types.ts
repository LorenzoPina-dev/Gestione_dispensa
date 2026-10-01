export interface Meta { requestId: string; traceId: string; schemaVersion: string; }
export interface ApiErrorBody { code: string; message: string; retryable: boolean; details?: Array<Record<string, unknown>>; }
export interface ErrorEnvelope { error: ApiErrorBody; meta: Meta; }
export interface Envelope<T> { data: T; meta?: Meta; }

export interface UserDto {
  userId: string;
  subject: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  locale: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}
export interface UserFamilySummaryDto {
  familyId: string;
  name: string;
  displayName?: string;
  role: "owner" | "admin" | "member" | "viewer";
  memberCount?: number;
  createdAt?: string;
}
export interface FamilyCreationResultDto { familyId: string; name: string; role: "owner"; createdAt: string; version: number; }
export interface FamilyDto { familyId: string; name: string; version: number; members: Array<{ userId: string; displayName: string | null; role: "owner" | "admin" | "member" | "viewer"; joinedAt: string }>; }
export type MembershipRole = "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED" | "PENDING";
export interface ManagedMembershipDto { id: string; familyId: string; userId: string; role: MembershipRole; status: MembershipStatus; version: number; name?: string; email?: string; avatar?: string; joinedAt?: string; }
export type InviteRole = "MANAGER" | "MEMBER" | "VIEWER";
export interface CreatedInviteDto { inviteId: string; email?: string; role: InviteRole; status: "CREATED" | "pending"; expiresAt: string; fallbackCode?: string; qrPayload?: string; }
export interface JoinAttemptDto { id: string; inviteId: string; userId?: string; state: "PENDING_AUTHENTICATION" | "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EXPIRED"; expiresAt: string; familyId?: string; role?: InviteRole; }
export interface AcceptInviteResultDto { familyId: string; userId: string; role: InviteRole; joinedAt: string; version: number; }

export type ProductUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
export interface ProductDto { id: string; canonicalName: string; brand?: string; defaultUnit: ProductUnit; status: "ACTIVE"; provenanceQuality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN"; version: number; category?: string; photoUrl?: string; calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; createdAt: string; updatedAt: string; }
export type BarcodeResolutionStatus = "MATCHED" | "UNKNOWN" | "DEGRADED";
export interface BarcodeResolutionDto { status: BarcodeResolutionStatus; identifierType: string; normalizedValue: string; product?: ProductDto; }
export type InventoryUnit = ProductUnit;
export type MovementKind = "RECEIPT" | "CONSUMPTION" | "WASTE" | "ADJUSTMENT" | "TRANSFER";
export interface StockItemDto { id: string; itemId?: string; familyId: string; productId: string; name?: string; quantity: number; unit: InventoryUnit; reorderPoint?: number; version: number; status?: "ACTIVE"; productName?: string; brand?: string; category?: string; provenance?: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN"; calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; location?: string; batches?: Array<{ quantity: number; expiryDate?: string }>; lotId?: string | null; expiresAt?: string | null; expirationSource?: "declared" | "estimated" | null; lotCode?: string | null; addedAt?: string; openedAt?: string | null; updatedAt?: string; }
export interface RecordMovementResultDto { stockItem?: StockItemDto; itemId: string; movementId?: string; consumedQuantity?: number; wastedQuantity?: number; remainingQuantity: number; removed: boolean; duplicate?: boolean; }
export type ShoppingItemState = "SUGGESTED" | "ACCEPTED" | "SNOOZED" | "IGNORED" | "COMPLETED";
export type ShoppingSourceType = "MANUAL" | "REORDER" | "OFFER" | "RECIPE";
export interface ShoppingListDto { listId: string; name: string; status: "open" | "closed" | "archived"; itemCount?: number; version: number; familyId?: string; ownerUserId?: string; }
export interface ShoppingItemDto { itemId: string; listId?: string; productId?: string; label: string; displayName?: string; quantity: number; unit: InventoryUnit; checked: boolean; state?: ShoppingItemState; sourceType?: ShoppingSourceType; sourceRef?: string; version: number; }
export interface ActiveShoppingListDto { list: ShoppingListDto; items: ShoppingItemDto[]; }
export interface AddShoppingItemResultDto { item: ShoppingItemDto; merged: boolean; }
export interface NotificationDto { notificationId?: string; id?: string; familyId?: string; type?: string; category?: "REORDER" | "INVITE" | "SYSTEM"; title: string; body: string; readAt?: string | null; createdAt: string; }
export interface NotificationPreferencesDto { expiration: boolean; lowStock: boolean; offers: boolean; family: boolean; system: boolean; channels: { inApp: boolean; email: boolean; push: boolean }; version: number; }
export interface RecipeIngredientDto { id?: string; productId?: string | null; name?: string; displayName?: string; amount?: number; quantity?: number; unit: InventoryUnit; allergens?: string[]; }
export interface RecipeDto { recipeId?: string; id?: string; title: string; source?: string; quality?: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN"; servings: number; timeMinutes?: number; difficulty?: "Facile" | "Medio" | "Difficile"; image?: string; tags?: string[]; caloriesPerServing?: number; steps: string[]; ingredients: RecipeIngredientDto[]; }
export interface RecipeMatchDto { recipe: RecipeDto; score: number; matchedIngredientNames?: string[]; missingIngredients: RecipeIngredientDto[]; }
export interface NutritionSummaryDto { caloriesKcal?: number; proteinG?: number; carbsG?: number; fatG?: number; period?: "today" | "week"; since?: string; totals?: { calories: number; protein: number; carbs: number; fat: number; fiber: number }; items?: Array<{ movementId: string; productId: string; productName: string; quantity: number; unit: string; occurredAt: string; nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number }; confidence: "CONFIRMED" | "ESTIMATED" | "UNKNOWN" }>; }
export interface ReadinessDto { status: "ready"; dependencies: Record<string, unknown>; }
export interface MovementDto { id: string; stockItemId?: string; kind?: MovementKind; type?: string; quantity: number; unit: InventoryUnit; source?: string; reason?: string | null; actorId?: string; actorUserId?: string; actorName?: string; occurredAt: string; createdAt?: string; metadata?: Record<string, unknown>; }
