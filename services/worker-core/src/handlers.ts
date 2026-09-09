import { JobError, type JobHandler } from "./job.js";

export interface StockMovementReceived {
  readonly eventId: string;
  readonly eventType: "inventory.stock.received" | "inventory.stock.consumed";
  readonly eventVersion: 1;
  readonly aggregateId: string;
  readonly familyId: string;
  readonly payload: {
    readonly stockItemId: string;
    readonly productId: string;
    readonly quantity: number;
    readonly unit: string;
    readonly occurredAt: string;
  };
}

export interface ReorderPointReached {
  readonly eventId: string;
  readonly eventType: "inventory.reorder-point-reached";
  readonly eventVersion: 1;
  readonly aggregateId: string;
  readonly familyId: string;
  readonly payload: {
    readonly productId: string;
    readonly stockItemId: string;
    readonly availableQuantity: number;
    readonly reorderPoint: number;
    readonly reason: "THRESHOLD_REACHED";
    readonly dedupeKey: string;
  };
}

export interface MovementConsumerRepository {
  applyMovementProjection(event: StockMovementReceived): Promise<{ applied: boolean }>;
}

export interface ReorderConsumerRepository {
  applySuggestion(event: ReorderPointReached): Promise<{ applied: boolean }>;
}

export function movementConsumer(repository: MovementConsumerRepository): JobHandler {
  return async ({ job }) => {
    const event = parseMovement(job.payload);
    const result = await repository.applyMovementProjection(event);
    return { applied: result.applied, eventId: event.eventId };
  };
}

export function reorderConsumer(repository: ReorderConsumerRepository): JobHandler {
  return async ({ job }) => {
    const event = parseReorder(job.payload);
    const result = await repository.applySuggestion(event);
    return { applied: result.applied, eventId: event.eventId };
  };
}

function parseMovement(payload: Readonly<Record<string, unknown>>): StockMovementReceived {
  if (
    payload.eventType !== "inventory.stock.received" &&
    payload.eventType !== "inventory.stock.consumed"
  ) {
    throw new JobError("INVALID_MOVEMENT_EVENT", "PERMANENT", "Unsupported movement event");
  }
  const event = payload as Partial<StockMovementReceived>;
  if (
    typeof event.eventId !== "string" ||
    event.eventVersion !== 1 ||
    typeof event.aggregateId !== "string" ||
    typeof event.familyId !== "string" ||
    event.payload === undefined ||
    typeof event.payload.stockItemId !== "string" ||
    typeof event.payload.productId !== "string" ||
    typeof event.payload.quantity !== "number" ||
    !Number.isFinite(event.payload.quantity)
  ) {
    throw new JobError("INVALID_MOVEMENT_EVENT", "PERMANENT", "Movement event is invalid");
  }
  return event as StockMovementReceived;
}

function parseReorder(payload: Readonly<Record<string, unknown>>): ReorderPointReached {
  const event = payload as Partial<ReorderPointReached>;
  if (
    event.eventType !== "inventory.reorder-point-reached" ||
    typeof event.eventId !== "string" ||
    event.eventVersion !== 1 ||
    typeof event.aggregateId !== "string" ||
    typeof event.familyId !== "string" ||
    event.payload === undefined ||
    typeof event.payload.dedupeKey !== "string" ||
    typeof event.payload.stockItemId !== "string" ||
    typeof event.payload.productId !== "string"
  ) {
    throw new JobError("INVALID_REORDER_EVENT", "PERMANENT", "Reorder event is invalid");
  }
  return event as ReorderPointReached;
}

export interface ReconciliationReport {
  readonly checked: number;
  readonly drifted: number;
  readonly corrections: readonly [];
}

export interface ReconciliationRepository {
  findInventoryDrift(
    familyId?: string,
  ): Promise<readonly { stockItemId: string; expected: number; actual: number }[]>;
}

export function reconciliationHandler(repository: ReconciliationRepository): JobHandler {
  return async ({ job }) => {
    const familyId = typeof job.payload.familyId === "string" ? job.payload.familyId : undefined;
    const drift = await repository.findInventoryDrift(familyId);
    return {
      checked: drift.length,
      drifted: drift.filter((item) => item.expected !== item.actual).length,
      corrections: [],
    } satisfies ReconciliationReport;
  };
}

export interface ProjectionRebuildRepository {
  rebuildProjection(projection: string, familyId?: string): Promise<{ rebuilt: number }>;
}

export function projectionRebuildHandler(repository: ProjectionRebuildRepository): JobHandler {
  return async ({ job }) => {
    const projection = job.payload.projection;
    if (typeof projection !== "string" || projection.trim() === "") {
      throw new JobError("INVALID_PROJECTION", "PERMANENT", "Projection name is required");
    }
    const familyId = typeof job.payload.familyId === "string" ? job.payload.familyId : undefined;
    const result = await repository.rebuildProjection(projection, familyId);
    return { projection, rebuilt: result.rebuilt };
  };
}
