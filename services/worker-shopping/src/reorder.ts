export type ReorderEventType = "PantryLowStock" | "PantryStockReplenished" | "PantryReorderPolicyDisabled";

export type ReorderEvent = {
  eventId: string;
  eventType: ReorderEventType;
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  aggregateId: string;
  familyId?: string | null;
  correlationId: string;
  causationId?: string | null;
  payload: Record<string, unknown>;
};

export function parseReorderEvent(raw: unknown): ReorderEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Partial<ReorderEvent>;
  if (typeof event.eventId !== "string" || typeof event.eventType !== "string" ||
      !["PantryLowStock", "PantryStockReplenished", "PantryReorderPolicyDisabled"].includes(event.eventType) ||
      event.schemaVersion !== 1 || typeof event.aggregateId !== "string" ||
      typeof event.correlationId !== "string" || typeof event.producer !== "string") return null;
  if (event.familyId !== null && event.familyId !== undefined && typeof event.familyId !== "string") return null;
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return null;
  return event as ReorderEvent;
}

export function lowStockSuggestionPayload(event: ReorderEvent): { productId: string; quantity: number; unit: string; reorderPoint: number } | null {
  const p = event.payload;
  if (typeof p.productId !== "string" || typeof p.reorderQuantity !== "number" ||
      !Number.isFinite(p.reorderQuantity) || p.reorderQuantity <= 0 ||
      typeof p.reorderPoint !== "number" || !Number.isFinite(p.reorderPoint) || p.reorderPoint < 0 ||
      typeof p.unit !== "string" || !p.unit.trim()) return null;
  return { productId: p.productId, quantity: p.reorderQuantity, unit: p.unit, reorderPoint: p.reorderPoint };
}
