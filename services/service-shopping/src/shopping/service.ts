type InventoryUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";

export type ShoppingItemState = "SUGGESTED" | "ACCEPTED" | "SNOOZED" | "IGNORED" | "COMPLETED";
export type ShoppingSourceType = "MANUAL" | "REORDER" | "OFFER" | "RECIPE";

export interface CreateShoppingListCommand {
  familyId: string;
  ownerUserId: string;
  name: string;
  traceId: string;
}

export interface AddShoppingItemCommand {
  familyId: string;
  listId: string;
  productId?: string;
  displayName: string;
  quantity: number;
  unit: InventoryUnit;
  packageId?: string;
  sourceType: ShoppingSourceType;
  sourceRef?: string;
  traceId: string;
}

export interface ShoppingList {
  id: string;
  familyId: string;
  ownerUserId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
}

export interface ShoppingItem {
  id: string;
  listId: string;
  productId: string | undefined;
  displayName: string;
  quantity: number;
  unit: InventoryUnit;
  packageId: string | undefined;
  state: ShoppingItemState;
  sourceType: ShoppingSourceType;
  sourceRef: string | undefined;
  version: number;
}

export interface ActiveShoppingList {
  list: ShoppingList;
  items: ShoppingItem[];
}

export interface ShoppingRepository {
  createListAtomic(input: CreateShoppingListCommand & { id: string }): Promise<ShoppingList>;
  addItemAtomic(
    input: AddShoppingItemCommand & { id: string },
  ): Promise<{ item: ShoppingItem; merged: boolean }>;
  /**
   * Returns the family's most recently created ACTIVE list together with its items, or
   * `undefined` if the family has no active list yet. Backs
   * `GET /api/v1/shopping/lists/active` (ShoppingController.getActiveList).
   */
  getActiveListByFamily(familyId: string): Promise<ActiveShoppingList | undefined>;
  /**
   * Optimistic-concurrency state transition (accept/snooze/ignore/complete) for a single item.
   * Returns `undefined` when the item isn't visible for that family/list, and throws
   * `ShoppingConflictError` when `expectedVersion` doesn't match the stored version. Backs
   * `PATCH /api/v1/shopping/lists/{listId}/items/{itemId}`.
   */
  getListById(familyId: string, listId: string): Promise<ActiveShoppingList | undefined>;
  archiveListAtomic(input: { familyId: string; listId: string; expectedVersion: number }): Promise<ShoppingList | undefined>;
  updateItemStateAtomic(input: {
    familyId: string;
    listId: string;
    itemId: string;
    expectedVersion: number;
    state: ShoppingItemState;
  }): Promise<ShoppingItem | undefined>;
}

export interface ShoppingIdGenerator {
  next(): string;
}

/**
 * Narrow seam onto InventoryService, used only by ShoppingService.restockItem. Kept minimal (not
 * the full InventoryService) so shopping doesn't need to know about location/expiry/etc. --
 * those are inventory's concerns, and its own createStockItem already merges onto an existing
 * (possibly DEPLETED) stock item for the same product instead of duplicating it, see
 * inventory/postgres.ts createStockItemAtomic and 0016_stock-dedup.sql.
 */
export interface InventoryRestocker {
  restock(input: {
    familyId: string;
    productId: string;
    quantity: number;
    unit: InventoryUnit;
    actorId: string;
    traceId: string;
    authorization?: string | undefined;
  }): Promise<{ stockItemId: string; quantity: number }>;
}

export class ShoppingValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Shopping command is invalid: ${issues.join("; ")}`);
    this.name = "ShoppingValidationError";
    this.issues = issues;
  }
}

export class ShoppingConflictError extends Error {
  public readonly code = "VERSION_CONFLICT";

  public constructor(message: string) {
    super(message);
    this.name = "ShoppingConflictError";
  }
}

export class ShoppingNotFoundError extends Error {
  public readonly code = "NOT_FOUND_OR_NOT_VISIBLE";

  public constructor(message = "Shopping item is not visible.") {
    super(message);
    this.name = "ShoppingNotFoundError";
  }
}

const VALID_ITEM_STATES: readonly ShoppingItemState[] = [
  "SUGGESTED",
  "ACCEPTED",
  "SNOOZED",
  "IGNORED",
  "COMPLETED",
];

export class ShoppingService {
  private readonly repository: ShoppingRepository;
  private readonly ids: ShoppingIdGenerator;
  private readonly inventory: InventoryRestocker | undefined;

  /**
   * `inventory` is optional so existing call sites/tests that only need list/item management
   * keep working unconfigured; `restockItem` throws a clear error if called without it.
   */
  public constructor(repository: ShoppingRepository, ids: ShoppingIdGenerator, inventory?: InventoryRestocker) {
    this.repository = repository;
    this.ids = ids;
    this.inventory = inventory;
  }

  public async createList(command: CreateShoppingListCommand): Promise<ShoppingList> {
    const issues = [];
    if (!command.familyId.trim() || !command.ownerUserId.trim())
      issues.push("familyId and ownerUserId are required");
    if (command.name.trim().length < 1 || command.name.trim().length > 120)
      issues.push("name must be 1-120 characters");
    if (command.traceId.trim().length < 16) issues.push("traceId is required");
    if (issues.length > 0) throw new ShoppingValidationError(issues);
    return this.repository.createListAtomic({
      ...command,
      name: command.name.trim(),
      id: this.ids.next(),
    });
  }

  public async addItem(
    command: AddShoppingItemCommand,
  ): Promise<{ item: ShoppingItem; merged: boolean }> {
    const issues = [];
    if (!command.familyId.trim() || !command.listId.trim())
      issues.push("familyId and listId are required");
    if (!command.displayName.trim() || command.displayName.trim().length > 240)
      issues.push("displayName is invalid");
    if (!Number.isFinite(command.quantity) || command.quantity <= 0)
      issues.push("quantity must be positive");
    if (command.traceId.trim().length < 16) issues.push("traceId is required");
    if (issues.length > 0) throw new ShoppingValidationError(issues);
    return this.repository.addItemAtomic({
      ...command,
      displayName: command.displayName.trim(),
      id: this.ids.next(),
    });
  }

  public async getActiveList(familyId: string): Promise<ActiveShoppingList | undefined> {
    if (!familyId.trim()) throw new ShoppingValidationError(["familyId is required"]);
    return this.repository.getActiveListByFamily(familyId);
  }

  public async getList(familyId: string, listId: string): Promise<ActiveShoppingList> {
    if (!familyId.trim() || !listId.trim()) throw new ShoppingValidationError(["familyId and listId are required"]);
    const result = await this.repository.getListById(familyId, listId);
    if (result === undefined) throw new ShoppingNotFoundError("Shopping list is not visible.");
    return result;
  }

  public async archiveList(command: { familyId: string; listId: string; expectedVersion: number }): Promise<ShoppingList> {
    if (!command.familyId.trim() || !command.listId.trim() || !Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)
      throw new ShoppingValidationError(["familyId, listId and expectedVersion are required"]);
    const result = await this.repository.archiveListAtomic(command);
    if (result === undefined) throw new ShoppingNotFoundError("Shopping list is not visible.");
    return result;
  }

  public async updateItemState(command: {
    familyId: string;
    listId: string;
    itemId: string;
    expectedVersion: number;
    state: ShoppingItemState;
  }): Promise<ShoppingItem> {
    const issues: string[] = [];
    if (!command.familyId.trim() || !command.listId.trim() || !command.itemId.trim())
      issues.push("familyId, listId and itemId are required");
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)
      issues.push("expectedVersion is invalid");
    if (!VALID_ITEM_STATES.includes(command.state)) issues.push("state is invalid");
    if (issues.length > 0) throw new ShoppingValidationError(issues);

    const updated = await this.repository.updateItemStateAtomic(command);
    if (updated === undefined) throw new ShoppingNotFoundError();
    return updated;
  }

  /**
   * Applies the same state transition to several items at once (Spesa.tsx's "accetta
   * selezionati"). Best-effort per item: a single stale/missing item doesn't fail the whole
   * batch, it's reported in `failedItemIds` instead — see docs on the ACTION_STATES vocabulary
   * used by the domain journeys in services/web/src/domain/shopping-workflow.ts.
   */
  public async batchUpdateItemState(command: {
    familyId: string;
    listId: string;
    itemIds: readonly string[];
    state: ShoppingItemState;
  }): Promise<{ updated: ShoppingItem[]; failedItemIds: string[] }> {
    if (!command.familyId.trim() || !command.listId.trim())
      throw new ShoppingValidationError(["familyId and listId are required"]);
    if (command.itemIds.length === 0)
      throw new ShoppingValidationError(["itemIds must contain at least one id"]);
    if (!VALID_ITEM_STATES.includes(command.state))
      throw new ShoppingValidationError(["state is invalid"]);

    const updated: ShoppingItem[] = [];
    const failedItemIds: string[] = [];
    for (const itemId of command.itemIds) {
      try {
        const current = await this.repository.getActiveListByFamily(command.familyId);
        const existing = current?.items.find((item) => item.id === itemId);
        if (existing === undefined) {
          failedItemIds.push(itemId);
          continue;
        }
        const result = await this.repository.updateItemStateAtomic({
          familyId: command.familyId,
          listId: command.listId,
          itemId,
          expectedVersion: existing.version,
          state: command.state,
        });
        if (result === undefined) failedItemIds.push(itemId);
        else updated.push(result);
      } catch {
        failedItemIds.push(itemId);
      }
    }
    return { updated, failedItemIds };
  }

  /**
   * Backs `POST /api/v1/shopping/lists/{listId}/items/{itemId}/restock`: the "segna come
   * comprato" action for a shopping item that references a known product (added either from the
   * "prodotti finiti" picker or after resolving a barcode -- see AddShoppingItemCommand). Does
   * two things atomically from the caller's point of view: adds the quantity back to the pantry
   * (merging onto the existing/depleted stock item rather than creating a new one, see
   * inventory/postgres.ts) and marks the shopping item COMPLETED. An item with no `productId`
   * (a free-text entry never resolved to a catalog product) can't be restocked this way -- it
   * has nothing for inventory to attach a stock item to.
   */
  public async restockItem(command: {
    familyId: string;
    listId: string;
    itemId: string;
    expectedVersion: number;
    actorId: string;
    traceId: string;
    authorization?: string | undefined;
  }): Promise<{ shoppingItem: ShoppingItem; stockItemId: string }> {
    if (this.inventory === undefined)
      throw new Error("ShoppingService.restockItem requires an InventoryRestocker.");
    const issues: string[] = [];
    if (!command.familyId.trim() || !command.listId.trim() || !command.itemId.trim())
      issues.push("familyId, listId and itemId are required");
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)
      issues.push("expectedVersion is invalid");
    if (!command.actorId.trim() || command.traceId.trim().length < 16)
      issues.push("actor and traceId are required");
    if (issues.length > 0) throw new ShoppingValidationError(issues);

    const list = await this.repository.getListById(command.familyId, command.listId);
    const item = list?.items.find((candidate) => candidate.id === command.itemId);
    if (item === undefined) throw new ShoppingNotFoundError();
    if (item.productId === undefined)
      throw new ShoppingValidationError([
        "item has no linked product; add it to the pantry manually instead",
      ]);

    const restocked = await this.inventory.restock({
      familyId: command.familyId,
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      actorId: command.actorId,
      traceId: command.traceId,
      authorization: command.authorization,
    });
    const updated = await this.repository.updateItemStateAtomic({
      familyId: command.familyId,
      listId: command.listId,
      itemId: command.itemId,
      expectedVersion: command.expectedVersion,
      state: "COMPLETED",
    });
    if (updated === undefined) throw new ShoppingNotFoundError();
    return { shoppingItem: updated, stockItemId: restocked.stockItemId };
  }
}
