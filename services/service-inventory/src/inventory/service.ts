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
  location?: string;
  expiresAt?: Date;
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
  /** Version observed by the client and enforced atomically by the repository. */
  expectedVersion: number;
}

export interface StockItem {
  id: string;
  familyId: string;
  productId: string;
  quantity: number;
  unit: InventoryUnit;
  reorderPoint: number | undefined;
  version: number;
  status: "ACTIVE" | "DEPLETED";
  productName?: string;
  brand?: string;
  category?: string;
  provenance?: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  /** Deprecated: kept only as "last known location" for old clients. See batches[].location. */
  location?: string;
  /**
   * Denormalized read-model field (see migration 0017_pantry-optimization-and-new-features.sql):
   * maintained by a Postgres trigger on stock_lots, so sorting by expiry never needs a live
   * aggregate over stock_lots at read time.
   */
  earliestExpiryAt?: string;
  batches?: readonly {
    quantity: number;
    expiryDate?: string;
    /** Per-lot location, added by 0017: a single stock item can now have lots in several places. */
    locationId?: string;
    location?: string;
  }[];
}

export type StockItemSortBy = "updatedAt" | "expiry" | "name";
export type SortDirection = "ASC" | "DESC";

/**
 * Query options for the pantry read model. All fields are optional so every existing call site
 * (`listByFamily(familyId)`) keeps working unchanged -- see InventoryService.listStockItems.
 */
export interface ListStockItemsQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
  locationId?: string | undefined;
  sortBy?: "name" | "updatedAt" | "expiry" | undefined;
  sortDir?: "ASC" | "DESC" | undefined;
}

export interface PagedStockItems {
  items: StockItem[];
  page: number;
  pageSize: number;
  total: number;
}

export const DEFAULT_STOCK_ITEMS_PAGE_SIZE = 50;
export const MAX_STOCK_ITEMS_PAGE_SIZE = 200;

export function normalizeListQuery(query: ListStockItemsQuery | undefined): {
  page: number;
  pageSize: number;
  sortBy: StockItemSortBy;
  sortDir: SortDirection;
  search: string | undefined;
  locationId: string | undefined;
} {
  const page = query?.page !== undefined && Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
  const pageSize =
    query?.pageSize !== undefined && Number.isInteger(query.pageSize) && query.pageSize > 0
      ? Math.min(query.pageSize, MAX_STOCK_ITEMS_PAGE_SIZE)
      : DEFAULT_STOCK_ITEMS_PAGE_SIZE;
  const sortBy: StockItemSortBy =
    query?.sortBy === "expiry" || query?.sortBy === "name" ? query.sortBy : "updatedAt";
  const sortDir: SortDirection = query?.sortDir === "DESC" ? "DESC" : "ASC";
  const search = query?.search?.trim() ? query.search.trim() : undefined;
  const locationId = query?.locationId?.trim() ? query.locationId.trim() : undefined;
  return { page, pageSize, sortBy, sortDir, search, locationId };
}

export interface InventoryRepository {
  createStockItemAtomic(input: CreateStockItemCommand & { id: string }): Promise<StockItem>;
  recordMovementAtomic(
    input: RecordMovementCommand,
  ): Promise<{ stockItem: StockItem; movementId: string; duplicate: boolean }>;
  /**
   * Lists active stock items for a family, with pagination, trigram name search, per-lot
   * location filtering and sorting by expiry/name/last-updated. Backs the read-only
   * `GET /api/v1/inventory/stock-items` HTTP surface (InventoryController.listStockItems).
   */
  listByFamily(familyId: string, query?: ListStockItemsQuery): Promise<PagedStockItems>;
  /**
   * Lists stock items in a specific status (currently only 'DEPLETED' is used, by
   * InventoryService.listDepletedStockItems) -- backs the "prodotti finiti" picker the shopping
   * list uses to offer restocking a known product instead of only searching for a new one.
   */
  listByFamilyAndStatus(familyId: string, status: "ACTIVE" | "DEPLETED"): Promise<StockItem[]>;
  getById(stockItemId: string): Promise<StockItem | undefined>;
  listMovements(stockItemId: string, familyId: string): Promise<readonly Record<string, unknown>[]>;
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

  public async getStockItem(stockItemId: string): Promise<StockItem | undefined> { return this.repository.getById(stockItemId); }

  public async listMovements(stockItemId: string, familyId: string): Promise<readonly Record<string, unknown>[]> { return this.repository.listMovements(stockItemId, familyId); }

  /**
   * Backs `GET /api/v1/inventory/stock-items?familyId=...`. Supports pagination, trigram/ILIKE
   * search on the product name, filtering by the location of an active lot, and sorting by
   * expiry/name/last-updated (see ListStockItemsQuery). Every field is optional so old callers
   * that only pass `familyId` keep receiving the same first page, default-sorted exactly as
   * before -- only the response shape gained the additive `page`/`pageSize`/`total` envelope.
   */
  public async listStockItems(familyId: string, query?: ListStockItemsQuery): Promise<PagedStockItems> {
    if (!familyId.trim()) throw new InventoryValidationError(["familyId is required"]);
    return this.repository.listByFamily(familyId, query);
  }

  /**
   * Backs the shopping list's "prodotti finiti" picker: products whose last stock item ran out
   * (see recordMovementAtomic's DEPLETED transition) and that a person can restock with one tap
   * instead of searching from scratch. See AddShoppingItemCommand.sourceType = 'REORDER'.
   */
  public async listDepletedStockItems(familyId: string): Promise<StockItem[]> {
    if (!familyId.trim()) throw new InventoryValidationError(["familyId is required"]);
    return this.repository.listByFamilyAndStatus(familyId, "DEPLETED");
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
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)
    issues.push("expectedVersion must be a positive integer");
  return issues;
}
