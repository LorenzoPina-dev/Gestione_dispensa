import type { InventoryUnit } from "../inventory/service.js";

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
  status: "ACTIVE";
  version: 1;
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
}

export interface ShoppingIdGenerator {
  next(): string;
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

export class ShoppingService {
  private readonly repository: ShoppingRepository;
  private readonly ids: ShoppingIdGenerator;

  public constructor(repository: ShoppingRepository, ids: ShoppingIdGenerator) {
    this.repository = repository;
    this.ids = ids;
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
}
