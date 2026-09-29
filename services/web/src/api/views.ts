import { apiRequest } from "./client";
import type {
  FamilyDto,
  ManagedMembershipDto,
  ActiveShoppingListDto,
  NotificationDto,
  NutritionSummaryDto,
  RecipeMatchDto,
  StockItemDto,
} from "./types";

export interface NavigationSummaryDto {
  expiredCount: number;
  expiringSoonCount: number;
  unreadNotifications: number;
  pendingShopping: number;
}

export interface ScreenViewBase {
  familyId: string;
  family?: FamilyDto;
  members?: ManagedMembershipDto[];
  pantry?: StockItemDto[];
  shopping?: ActiveShoppingListDto | null;
  notifications?: NotificationDto[];
  suggestedRecipes?: RecipeMatchDto[];
  nutrition?: NutritionSummaryDto;
  navigationSummary: NavigationSummaryDto;
}

export interface FamilyScreenView extends ScreenViewBase {
  family: FamilyDto;
  members: ManagedMembershipDto[];
  invites: Array<{ id?: string; inviteId?: string; role: string; status: string; expiresAt: string; fallbackCode?: string; createdAt: string }>;
}

export interface NotificationsScreenView extends ScreenViewBase {
  notifications: NotificationDto[];
}

export function getDashboardView(familyId: string, signal?: AbortSignal): Promise<ScreenViewBase> {
  return apiRequest(`/views/dashboard-today`, { query: { familyId }, signal });
}

export function getPantryScreenView(familyId: string, signal?: AbortSignal): Promise<ScreenViewBase> {
  return apiRequest(`/views/pantry-screen`, { query: { familyId }, signal });
}

export function getShoppingScreenView(familyId: string, signal?: AbortSignal): Promise<ScreenViewBase> {
  return apiRequest(`/views/shopping-screen`, { query: { familyId }, signal });
}

export function getRecipesScreenView(familyId: string, signal?: AbortSignal): Promise<ScreenViewBase> {
  return apiRequest(`/views/recipes-screen`, { query: { familyId }, signal });
}

export function getNutritionScreenView(familyId: string, signal?: AbortSignal): Promise<ScreenViewBase> {
  return apiRequest(`/views/nutrition-screen`, { query: { familyId }, signal });
}

export function getFamilyScreenView(familyId: string, signal?: AbortSignal): Promise<FamilyScreenView> {
  return apiRequest(`/views/family-screen`, { query: { familyId }, signal });
}

export function getNotificationsScreenView(familyId: string, signal?: AbortSignal): Promise<NotificationsScreenView> {
  return apiRequest(`/views/notifications-screen`, { query: { familyId }, signal });
}
