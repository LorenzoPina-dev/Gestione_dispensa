/**
 * Request-body validators/parsers for every mutating route. Each returns `undefined` on
 * anything invalid, which every route treats uniformly as a 400 VALIDATION_ERROR.
 */
import type { InviteRole } from "../family/invites.js";
import type { InventoryUnit, MovementKind } from "../inventory/service.js";
import type { IdentifierType, ProductUnit } from "../catalog/service.js";
import type { ShoppingItemState, ShoppingSourceType } from "../shopping/service.js";

export const INVENTORY_UNITS: readonly InventoryUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];
export const MOVEMENT_KINDS: readonly MovementKind[] = [
  "RECEIPT",
  "CONSUMPTION",
  "WASTE",
  "ADJUSTMENT",
  "TRANSFER",
];
export const PRODUCT_UNITS: readonly ProductUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];
export const IDENTIFIER_TYPES: readonly IdentifierType[] = [
  "EAN8",
  "EAN13",
  "GTIN12",
  "GTIN14",
  "SKU",
  "BARCODE",
];
export const SHOPPING_SOURCE_TYPES: readonly ShoppingSourceType[] = ["MANUAL", "REORDER", "OFFER", "RECIPE"];
export const SHOPPING_ITEM_STATES: readonly ShoppingItemState[] = [
  "SUGGESTED",
  "ACCEPTED",
  "SNOOZED",
  "IGNORED",
  "COMPLETED",
];

type Body = Record<string, unknown>;

export function parseCreateFamilyBody(
  body: Body,
): { displayName: string; locale: string; timezone: string; unitSystem: "METRIC" | "IMPERIAL" } | undefined {
  const { displayName, locale, timezone, unitSystem } = body;
  if (
    typeof displayName !== "string" ||
    typeof locale !== "string" ||
    typeof timezone !== "string" ||
    (unitSystem !== "METRIC" && unitSystem !== "IMPERIAL")
  ) {
    return undefined;
  }
  return { displayName, locale, timezone, unitSystem };
}

export function parseCreateInviteBody(body: Body) {
  const { role, expiresInSeconds } = body;
  const roles: readonly InviteRole[] = ["MANAGER", "MEMBER", "VIEWER"];
  if (
    typeof role !== "string" ||
    !roles.includes(role as InviteRole) ||
    typeof expiresInSeconds !== "number" ||
    !Number.isFinite(expiresInSeconds)
  ) {
    return undefined;
  }
  return { role: role as InviteRole, expiresInSeconds };
}

export function parseResolveInviteBody(body: Body) {
  const { token, browserBindingHash } = body;
  if (typeof token !== "string" || token.length === 0) return undefined;
  if (typeof browserBindingHash !== "string" || !/^[0-9a-f]{16,128}$/i.test(browserBindingHash)) {
    return undefined;
  }
  return { token, browserBindingHash };
}

export function parseResolveInviteByCodeBody(body: Body) {
  const { code, browserBindingHash } = body;
  if (typeof code !== "string" || !/^\d{6}$/.test(code.replace(/[^0-9]/g, ""))) return undefined;
  if (typeof browserBindingHash !== "string" || !/^[0-9a-f]{16,128}$/i.test(browserBindingHash)) {
    return undefined;
  }
  return { code: code.replace(/[^0-9]/g, ""), browserBindingHash };
}

export function parseAcceptInviteBody(body: Body) {
  const { consentVersion } = body;
  if (typeof consentVersion !== "string" || consentVersion.trim().length === 0) return undefined;
  return { consentVersion };
}

export function parseUpdateMembershipBody(body: Body): { role: string; status: string } | undefined {
  const { role, status } = body;
  const roles = ["ADMIN", "MANAGER", "MEMBER", "VIEWER"];
  const statuses = ["ACTIVE", "SUSPENDED"];
  if (typeof role !== "string" || !roles.includes(role) || typeof status !== "string" || !statuses.includes(status)) {
    return undefined;
  }
  return { role, status };
}

export function parseCreateStockItemBody(body: Body):
  | {
      familyId: string;
      productId: string;
      packageId?: string;
      locationId?: string;
      location?: string;
      expiresAt?: string;
      quantity: number;
      unit: InventoryUnit;
      reorderPoint?: number;
    }
  | undefined {
  const { familyId, productId, packageId, locationId, location, expiresAt, quantity, unit, reorderPoint } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof productId !== "string" ||
    productId.length === 0 ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    typeof unit !== "string" ||
    !INVENTORY_UNITS.includes(unit as InventoryUnit) ||
    (packageId !== undefined && typeof packageId !== "string") ||
    (locationId !== undefined && typeof locationId !== "string") ||
    (location !== undefined && typeof location !== "string") ||
    (expiresAt !== undefined && typeof expiresAt !== "string") ||
    (reorderPoint !== undefined && (typeof reorderPoint !== "number" || !Number.isFinite(reorderPoint)))
  ) {
    return undefined;
  }
  if (expiresAt !== undefined && Number.isNaN(new Date(expiresAt).getTime())) return undefined;
  return {
    familyId,
    productId,
    ...(packageId !== undefined ? { packageId: packageId as string } : {}),
    ...(locationId !== undefined ? { locationId: locationId as string } : {}),
    ...(location !== undefined ? { location: location as string } : {}),
    ...(expiresAt !== undefined ? { expiresAt: expiresAt as string } : {}),
    quantity,
    unit: unit as InventoryUnit,
    ...(reorderPoint !== undefined ? { reorderPoint: reorderPoint as number } : {}),
  };
}

export function parseRecordMovementBody(body: Body):
  | {
      familyId: string;
      kind: MovementKind;
      quantity: number;
      unit: InventoryUnit;
      source: string;
      clientOperationId: string;
      occurredAt: Date;
    }
  | undefined {
  const { familyId, kind, quantity, unit, source, clientOperationId, occurredAt } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof kind !== "string" ||
    !MOVEMENT_KINDS.includes(kind as MovementKind) ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    typeof unit !== "string" ||
    !INVENTORY_UNITS.includes(unit as InventoryUnit) ||
    typeof source !== "string" ||
    source.length === 0 ||
    typeof clientOperationId !== "string" ||
    clientOperationId.length === 0 ||
    typeof occurredAt !== "string"
  ) {
    return undefined;
  }
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) return undefined;
  return {
    familyId,
    kind: kind as MovementKind,
    quantity,
    unit: unit as InventoryUnit,
    source,
    clientOperationId,
    occurredAt: occurredAtDate,
  };
}

export function parseCreateProductBody(
  body: Body,
): { canonicalName: string; brand?: string; defaultUnit: ProductUnit; category?: string; calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number } | undefined {
  const { canonicalName, brand, defaultUnit, category, calories, protein, carbs, fat, fiber } = body;
  if (
    typeof canonicalName !== "string" ||
    canonicalName.length === 0 ||
    typeof defaultUnit !== "string" ||
    !PRODUCT_UNITS.includes(defaultUnit as ProductUnit) ||
    (brand !== undefined && typeof brand !== "string") ||
    (category !== undefined && typeof category !== "string") ||
    [calories, protein, carbs, fat, fiber].some(v => v !== undefined && (typeof v !== "number" || !Number.isFinite(v)))
  ) {
    return undefined;
  }
  return {
    canonicalName,
    ...(brand !== undefined ? { brand: brand as string } : {}),
    defaultUnit: defaultUnit as ProductUnit,
    ...(category !== undefined ? { category: category as string } : {}),
    ...(calories !== undefined ? { calories } : {}),
    ...(protein !== undefined ? { protein } : {}),
    ...(carbs !== undefined ? { carbs } : {}),
    ...(fat !== undefined ? { fat } : {}),
    ...(fiber !== undefined ? { fiber } : {}),
  };
}

export function parseResolveBarcodeBody(body: Body): { identifierType: IdentifierType; value: string } | undefined {
  const identifierType = typeof body.identifierType === "string" ? body.identifierType : "";
  const value = typeof body.value === "string" ? body.value : "";
  if (!IDENTIFIER_TYPES.includes(identifierType as IdentifierType) || value.trim().length === 0) return undefined;
  return { identifierType: identifierType as IdentifierType, value };
}

export function parseUpdateShoppingItemBody(body: Body): { familyId: string; state: ShoppingItemState } | undefined {
  const { familyId, state } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof state !== "string" ||
    !SHOPPING_ITEM_STATES.includes(state as ShoppingItemState)
  ) {
    return undefined;
  }
  return { familyId, state: state as ShoppingItemState };
}

export function parseBatchActionBody(
  body: Body,
): { familyId: string; itemIds: string[]; state: ShoppingItemState } | undefined {
  const { familyId, itemIds, state } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    !itemIds.every((id) => typeof id === "string" && id.length > 0) ||
    typeof state !== "string" ||
    !SHOPPING_ITEM_STATES.includes(state as ShoppingItemState)
  ) {
    return undefined;
  }
  return { familyId, itemIds: itemIds as string[], state: state as ShoppingItemState };
}

export function parseCreateShoppingListBody(body: Body): { familyId: string; name: string } | undefined {
  const { familyId, name } = body;
  if (typeof familyId !== "string" || familyId.length === 0 || typeof name !== "string" || name.trim().length === 0) {
    return undefined;
  }
  return { familyId, name };
}

export function parseAddShoppingItemBody(body: Body):
  | {
      familyId: string;
      productId?: string;
      displayName: string;
      quantity: number;
      unit: InventoryUnit;
      packageId?: string;
      sourceType: ShoppingSourceType;
      sourceRef?: string;
    }
  | undefined {
  const { familyId, productId, displayName, quantity, unit, packageId, sourceType, sourceRef } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof displayName !== "string" ||
    displayName.trim().length === 0 ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    typeof unit !== "string" ||
    !INVENTORY_UNITS.includes(unit as InventoryUnit) ||
    typeof sourceType !== "string" ||
    !SHOPPING_SOURCE_TYPES.includes(sourceType as ShoppingSourceType) ||
    (productId !== undefined && typeof productId !== "string") ||
    (packageId !== undefined && typeof packageId !== "string") ||
    (sourceRef !== undefined && typeof sourceRef !== "string")
  ) {
    return undefined;
  }
  return {
    familyId,
    ...(productId !== undefined ? { productId: productId as string } : {}),
    displayName,
    quantity,
    unit: unit as InventoryUnit,
    ...(packageId !== undefined ? { packageId: packageId as string } : {}),
    sourceType: sourceType as ShoppingSourceType,
    ...(sourceRef !== undefined ? { sourceRef: sourceRef as string } : {}),
  };
}

export function parseReplayBody(body: Body): { reason: string; approvalId: string } | undefined {
  const { reason, approvalId } = body;
  if (
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    typeof approvalId !== "string" ||
    approvalId.trim().length === 0
  ) {
    return undefined;
  }
  return { reason, approvalId };
}

export function parseErasureRequestBody(body: Body): { familyId: string; confirmed: boolean } | undefined {
  const { familyId, confirmed } = body;
  if (typeof familyId !== "string" || familyId.length === 0 || typeof confirmed !== "boolean") return undefined;
  return { familyId, confirmed };
}

export function parseConsentBody(
  body: Body,
): { purpose: string; granted: boolean; consentVersion: string } | undefined {
  const { purpose, granted, consentVersion } = body;
  if (
    typeof purpose !== "string" ||
    purpose.trim().length === 0 ||
    typeof granted !== "boolean" ||
    typeof consentVersion !== "string" ||
    consentVersion.trim().length === 0
  ) {
    return undefined;
  }
  return { purpose, granted, consentVersion };
}

export function parseExportRequestBody(body: Body): { familyId: string } | undefined {
  const { familyId } = body;
  if (typeof familyId !== "string" || familyId.length === 0) return undefined;
  return { familyId };
}

/** Validates a plain-object JSON body has actually been sent (not an array, not null, not a primitive). */
export function isPlainBody(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSubmitCandidateBody(body: Body):
  | {
      productId?: string;
      canonicalName: string;
      brand?: string;
      defaultUnit: ProductUnit;
      confidence: number;
      source: string;
    }
  | undefined {
  const { productId, canonicalName, brand, defaultUnit, confidence, source } = body;
  if (
    typeof canonicalName !== "string" ||
    canonicalName.trim().length === 0 ||
    canonicalName.length > 240 ||
    typeof defaultUnit !== "string" ||
    !PRODUCT_UNITS.includes(defaultUnit as ProductUnit) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    typeof source !== "string" ||
    source.trim().length === 0 ||
    (productId !== undefined && typeof productId !== "string") ||
    (brand !== undefined && typeof brand !== "string")
  ) {
    return undefined;
  }
  return {
    ...(productId !== undefined ? { productId: productId as string } : {}),
    canonicalName,
    ...(brand !== undefined ? { brand: brand as string } : {}),
    defaultUnit: defaultUnit as ProductUnit,
    confidence,
    source,
  };
}