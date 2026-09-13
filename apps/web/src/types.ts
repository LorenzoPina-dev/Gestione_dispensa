export type Role = "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
export type MemberStatus = "ACTIVE" | "SUSPENDED" | "REMOVED" | "PENDING";
export type InviteStatus = "CREATED" | "REVOKED" | "CONSUMED" | "EXPIRED";
export type ExpiryStatus = "UNKNOWN" | "FRESH" | "EXPIRING" | "EXPIRED";
export type ProvenanceQuality = "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
export type ConfidenceLabel = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
export type MovementType = "RECEIPT" | "CONSUMPTION" | "WASTE" | "ADJUSTMENT" | "TRANSFER";
export type ShoppingItemState = "SUGGESTED" | "ACCEPTED" | "SNOOZED" | "IGNORED" | "COMPLETED";
export type ShoppingItemSource = "MANUAL" | "REORDER" | "OFFER" | "RECIPE";
export type StorageLocation = "frigo" | "freezer" | "dispensa" | "altro";
export type ActionState = "IDLE" | "SUBMITTING" | "SUCCESS" | "ERROR" | "CONFLICT" | "OFFLINE";

export interface FamilyMember {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: Role;
  status: MemberStatus;
  joinedAt: string;
}

export interface Invite {
  inviteId: string;
  role: Role;
  status: InviteStatus;
  expiresAt: string;
  fallbackCode: string;
  createdAt: string;
}

export interface StockBatch {
  quantity: number;
  expiryDate?: string;
}

export interface StockItem {
  id: string;
  name: string;
  brand?: string;
  batches: StockBatch[];
  unit: string;
  reorderPoint?: number;
  location: StorageLocation;
  category: string;
  provenance: ProvenanceQuality;
  version: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export interface Movement {
  id: string;
  stockItemId: string;
  type: MovementType;
  quantity: number;
  unit: string;
  note?: string;
  by: string;
  at: string;
}

export interface ShoppingItem {
  id: string;
  displayName: string;
  quantity: number;
  unit: string;
  state: ShoppingItemState;
  sourceType: ShoppingItemSource;
  sourceRef?: string;
  version: number;
  addedBy?: string;
  addedAt?: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  lastEditedBy?: string;
  lastEditedAt?: string;
  items: ShoppingItem[];
}

export interface RecipeIngredient {
  name: string;
  stockItemId?: string;
  amount: number;
  unit: string;
  allergens: string[];
}

export interface Recipe {
  id: string;
  title: string;
  source: string;
  quality: ProvenanceQuality;
  servings: number;
  time: number;
  difficulty: "Facile" | "Medio" | "Difficile";
  ingredients: RecipeIngredient[];
  steps: string[];
  image: string;
  tags: string[];
  caloriesPerServing: number;
}

export interface RecipeMatch {
  recipe: Recipe;
  score: number;
  matchedIngredients: string[];
  missingIngredients: string[];
}

export interface NutrientValue {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  confidence: ConfidenceLabel;
}

export interface ConsumedItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  nutrients: NutrientValue;
  at: string;
}

export interface Notification {
  id: string;
  category: "REORDER" | "INVITE" | "SYSTEM";
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
}
