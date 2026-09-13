import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import {
  ShoppingService,
  ShoppingValidationError,
  type ActiveShoppingList,
  type AddShoppingItemCommand,
  type CreateShoppingListCommand,
} from "./service.js";

export interface ShoppingMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface ShoppingHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface ShoppingHttpSuccess<T> {
  data: T;
  meta: ShoppingHttpMeta;
}

export class ShoppingHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ShoppingHttpError";
  }
}

export class ShoppingController {
  private readonly shopping: ShoppingService;
  private readonly memberships: ShoppingMembershipReader;

  public constructor(shopping: ShoppingService, memberships: ShoppingMembershipReader) {
    this.shopping = shopping;
    this.memberships = memberships;
  }

  public async createList(
    principal: Principal | undefined,
    command: Omit<CreateShoppingListCommand, "ownerUserId">,
    meta: ShoppingHttpMeta,
  ): Promise<ShoppingHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new ShoppingHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertWrite(principal, command.familyId);
    const list = await this.shopping.createList({ ...command, ownerUserId: principal.subject });
    return success(list, meta);
  }

  public async addItem(
    principal: Principal | undefined,
    command: AddShoppingItemCommand,
    meta: ShoppingHttpMeta,
  ): Promise<ShoppingHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new ShoppingHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertWrite(principal, command.familyId);
    return success(await this.shopping.addItem(command), meta);
  }

  /**
   * Backs `GET /api/v1/shopping/lists/active?familyId=...`. Any active family member may read.
   * Returns a 404 when the family has no active list yet, which the frontend treats the same as
   * any other unreachable/unavailable response (falls back to demo data).
   */
  public async getActiveList(
    principal: Principal | undefined,
    familyId: string,
    meta: ShoppingHttpMeta,
  ): Promise<ShoppingHttpSuccess<ActiveShoppingList>> {
    if (principal === undefined)
      throw new ShoppingHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    const active = await this.shopping.getActiveList(familyId);
    if (active === undefined)
      throw new ShoppingHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "No active shopping list.");
    return success(active, meta);
  }

  private async assertWrite(principal: Principal, familyId: string): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "shopping.write", resourceFamilyId: familyId })
        : authorize({
            principal,
            action: "shopping.write",
            resourceFamilyId: familyId,
            membership,
          });
    if (!decision.allowed)
      throw new ShoppingHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "Shopping operation is forbidden.",
      );
  }

  private async assertRead(principal: Principal, familyId: string): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "shopping.read", resourceFamilyId: familyId })
        : authorize({
            principal,
            action: "shopping.read",
            resourceFamilyId: familyId,
            membership,
          });
    if (!decision.allowed)
      throw new ShoppingHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "Shopping read is forbidden.",
      );
  }
}

export function toShoppingHttpError(
  error: unknown,
  meta: ShoppingHttpMeta,
): {
  status: number;
  body: { error: { code: string; message: string; retryable: boolean }; meta: ShoppingHttpMeta };
} {
  if (error instanceof ShoppingHttpError)
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, retryable: error.retryable },
        meta,
      },
    };
  if (error instanceof ShoppingValidationError)
    return {
      status: 422,
      body: {
        error: { code: error.code, message: "Shopping input is invalid.", retryable: false },
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

function success<T>(data: T, meta: ShoppingHttpMeta): ShoppingHttpSuccess<T> {
  return { data, meta };
}
