import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import {
  InventoryConflictError,
  InventoryService,
  InventoryValidationError,
  type CreateStockItemCommand,
  type RecordMovementCommand,
  type StockItem,
} from "./service.js";

export interface InventoryMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface InventoryReader {
  getStockItem(stockItemId: string): Promise<{ familyId: string; version: number } | undefined>;
}

export interface InventoryHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface InventoryHttpSuccess<T> {
  data: T;
  meta: InventoryHttpMeta;
}

export class InventoryHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "InventoryHttpError";
  }
}

export class InventoryController {
  private readonly inventory: InventoryService;
  private readonly memberships: InventoryMembershipReader;
  private readonly reader: InventoryReader;

  public constructor(
    inventory: InventoryService,
    memberships: InventoryMembershipReader,
    reader: InventoryReader,
  ) {
    this.inventory = inventory;
    this.memberships = memberships;
    this.reader = reader;
  }

  public async createStockItem(
    principal: Principal | undefined,
    command: Omit<CreateStockItemCommand, "actorId">,
    meta: InventoryHttpMeta,
  ): Promise<InventoryHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new InventoryHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertWrite(principal, command.familyId);
    return success(
      await this.inventory.createStockItem({ ...command, actorId: principal.subject }),
      meta,
    );
  }

  public async recordMovement(
    principal: Principal | undefined,
    command: Omit<RecordMovementCommand, "actorId">,
    ifMatch: string,
    meta: InventoryHttpMeta,
  ): Promise<InventoryHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new InventoryHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const stock = await this.reader.getStockItem(command.stockItemId);
    if (stock === undefined)
      throw new InventoryHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Stock item is not visible.");
    await this.assertWrite(principal, stock.familyId);
    if (parseVersion(ifMatch) !== stock.version)
      throw new InventoryHttpError(409, "VERSION_CONFLICT", "Stock item version is stale.");
    return success(
      await this.inventory.recordMovement({ ...command, actorId: principal.subject }),
      meta,
    );
  }

  /**
   * Backs `GET /api/v1/inventory/stock-items?familyId=...`. Any active family member (including
   * VIEWER) may read; only OWNER/MANAGER/MEMBER may write (see `assertWrite`).
   */
  public async listStockItems(
    principal: Principal | undefined,
    familyId: string,
    meta: InventoryHttpMeta,
  ): Promise<InventoryHttpSuccess<{ items: StockItem[] }>> {
    if (principal === undefined)
      throw new InventoryHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    const items = await this.inventory.listStockItems(familyId);
    return success({ items }, meta);
  }

  private async assertWrite(principal: Principal, familyId: string): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "inventory.write", resourceFamilyId: familyId })
        : authorize({
            principal,
            action: "inventory.write",
            resourceFamilyId: familyId,
            membership,
          });
    if (!decision.allowed)
      throw new InventoryHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "Inventory operation is forbidden.",
      );
  }

  private async assertRead(principal: Principal, familyId: string): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "inventory.read", resourceFamilyId: familyId })
        : authorize({
            principal,
            action: "inventory.read",
            resourceFamilyId: familyId,
            membership,
          });
    if (!decision.allowed)
      throw new InventoryHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "Inventory read is forbidden.",
      );
  }
}

export function toInventoryHttpError(
  error: unknown,
  meta: InventoryHttpMeta,
): {
  status: number;
  body: { error: { code: string; message: string; retryable: boolean }; meta: InventoryHttpMeta };
} {
  if (error instanceof InventoryHttpError)
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, retryable: error.retryable },
        meta,
      },
    };
  if (error instanceof InventoryValidationError)
    return {
      status: 422,
      body: {
        error: { code: error.code, message: "Inventory input is invalid.", retryable: false },
        meta,
      },
    };
  if (error instanceof InventoryConflictError)
    return {
      status: 409,
      body: {
        error: {
          code: error.code,
          message: "Inventory operation conflicts with current state.",
          retryable: false,
        },
        meta,
      },
    };
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        retryable: false,
      },
      meta,
    },
  };
}

function parseVersion(value: string): number {
  const normalized = value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const version = Number(normalized);
  return Number.isInteger(version) && version > 0 ? version : -1;
}

function success<T>(data: T, meta: InventoryHttpMeta): InventoryHttpSuccess<T> {
  return { data, meta };
}
