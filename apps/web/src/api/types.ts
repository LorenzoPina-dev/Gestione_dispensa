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

// --- Auth & Identity --------------------------------------------------------

export interface UserDto {
  id: string;
  email?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  preferredUsername?: string;
  roles?: string[];
  activeFamilyId?: string;
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
  /** Only present once the invite has been accepted. */
  familyId?: string;
  role?: InviteRole;
}

export interface UserFamilySummaryDto {
  familyId: string;
  displayName: string;
  role: string;
}

export type MembershipRole = "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED" | "PENDING";

export interface ManagedMembershipDto {
  id: string;
  familyId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  version: number;
  name?: string;
  email?: string;
  avatar?: string;
  joinedAt?: string;
}

// --- Catalog (apps/api/src/catalog/service.ts) -------------------------------

export type ProductUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";

export interface ProductDto {
  id: string;
  canonicalName: string;
  brand?: string;
  defaultUnit: ProductUnit;
  status: "ACTIVE";
  provenanceQuality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
  version: number;
  category?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
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
  productName?: string;
  brand?: string;
  category?: string;
  provenance?: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  location?: string;
  batches?: Array<{ quantity: number; expiryDate?: string }>;
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


export interface MovementDto {
  id: string;
  stockItemId: string;
  kind: MovementKind;
  quantity: number;
  unit: InventoryUnit;
  source: string;
  actorId?: string;
  actorName?: string;
  occurredAt: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationDto {
  id: string;
  familyId: string;
  category: "REORDER" | "INVITE" | "SYSTEM";
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
}

export interface RecipeIngredientDto {
  id: string;
  productId?: string;
  displayName: string;
  amount: number;
  unit: InventoryUnit;
  allergens: string[];
}
export interface RecipeDto {
  id: string;
  title: string;
  source?: string;
  quality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
  servings: number;
  timeMinutes: number;
  difficulty: "Facile" | "Medio" | "Difficile";
  image?: string;
  tags: string[];
  caloriesPerServing?: number;
  steps: string[];
  ingredients: RecipeIngredientDto[];
}
export interface RecipeMatchDto {
  recipe: RecipeDto;
  score: number;
  matchedIngredientNames: string[];
  missingIngredients: RecipeIngredientDto[];
}
export interface NutritionSummaryDto {
  since: string;
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  items: Array<{
    movementId: string;
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
    occurredAt: string;
    nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
    confidence: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
  }>;
}
