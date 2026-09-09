export type InventoryUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
export type MovementKind = "RECEIPT" | "CONSUMPTION" | "WASTE" | "ADJUSTMENT" | "TRANSFER";

export interface CreateStockItemCommand {
  familyId: string;
  productId: string;
  packageId?: string;
  locationId?: string;
  quantity: number;
  unit: InventoryUnit;
  reorderPoint?: number;
  actorId: string;
  traceId: string;
}

export interface RecordMovementCommand {
  familyId: string;
  stockItemId: string;
  kind: MovementKind;
  quantity: number;
  unit: InventoryUnit;
  source: string;
  clientOperationId: string;
  actorId: string;
  occurredAt: Date;
  traceId: string;
}

export interface StockItem {
  id: string;
  familyId: string;
  productId: string;
  quantity: number;
  unit: InventoryUnit;
  reorderPoint: number | undefined;
  version: number;
  status: "ACTIVE";
}

export interface InventoryRepository {
  createStockItemAtomic(input: CreateStockItemCommand & { id: string }): Promise<StockItem>;
  recordMovementAtomic(
    input: RecordMovementCommand,
  ): Promise<{ stockItem: StockItem; movementId: string; duplicate: boolean }>;
}

export interface InventoryIdGenerator {
  next(): string;
}

export class InventoryValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Inventory command is invalid: ${issues.join("; ")}`);
    this.name = "InventoryValidationError";
    this.issues = issues;
  }
}

export class InventoryConflictError extends Error {
  public readonly code = "INVENTORY_CONFLICT";

  public constructor(message: string) {
    super(message);
    this.name = "InventoryConflictError";
  }
}

export class InventoryService {
  private readonly repository: InventoryRepository;
  private readonly ids: InventoryIdGenerator;

  public constructor(repository: InventoryRepository, ids: InventoryIdGenerator) {
    this.repository = repository;
    this.ids = ids;
  }

  public async createStockItem(command: CreateStockItemCommand): Promise<StockItem> {
    const issues = validateStock(command);
    if (issues.length > 0) throw new InventoryValidationError(issues);
    return this.repository.createStockItemAtomic({ ...command, id: this.ids.next() });
  }

  public async recordMovement(
    command: RecordMovementCommand,
  ): Promise<{ stockItem: StockItem; movementId: string; duplicate: boolean }> {
    const issues = validateMovement(command);
    if (issues.length > 0) throw new InventoryValidationError(issues);
    return this.repository.recordMovementAtomic(command);
  }
}

export function movementDelta(kind: MovementKind, quantity: number): number {
  if (kind === "RECEIPT") return quantity;
  if (kind === "CONSUMPTION" || kind === "WASTE") return -quantity;
  return 0;
}

function validateStock(command: CreateStockItemCommand): string[] {
  const issues: string[] = [];
  if (!command.familyId.trim()) issues.push("familyId is required");
  if (!command.productId.trim()) issues.push("productId is required");
  if (!Number.isFinite(command.quantity) || command.quantity <= 0)
    issues.push("quantity must be positive");
  if (
    command.reorderPoint !== undefined &&
    (!Number.isFinite(command.reorderPoint) || command.reorderPoint < 0)
  )
    issues.push("reorderPoint must be non-negative");
  if (!command.actorId.trim()) issues.push("actorId is required");
  if (command.traceId.trim().length < 16) issues.push("traceId is required");
  return issues;
}

function validateMovement(command: RecordMovementCommand): string[] {
  const issues: string[] = [];
  if (!command.familyId.trim() || !command.stockItemId.trim())
    issues.push("family and stock item are required");
  if (!Number.isFinite(command.quantity) || command.quantity <= 0)
    issues.push("quantity must be positive");
  if (!command.source.trim() || !command.clientOperationId.trim())
    issues.push("source and clientOperationId are required");
  if (!command.actorId.trim() || command.traceId.trim().length < 16)
    issues.push("actor and traceId are required");
  return issues;
}
