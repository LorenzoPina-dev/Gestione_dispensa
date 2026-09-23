import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import { NutritionService, NutritionValidationError, type NutritionSummary } from "./service.js";

export interface NutritionMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface NutritionHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface NutritionHttpSuccess<T> {
  data: T;
  meta: NutritionHttpMeta;
}

export class NutritionHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "NutritionHttpError";
  }
}

export class NutritionController {
  private readonly nutrition: NutritionService;
  private readonly memberships: NutritionMembershipReader;

  public constructor(nutrition: NutritionService, memberships: NutritionMembershipReader) {
    this.nutrition = nutrition;
    this.memberships = memberships;
  }

  /** Backs `GET /api/v1/nutrition/summary?familyId=...&period=today|week`. */
  public async getSummary(
    principal: Principal | undefined,
    familyId: string,
    period: "today" | "week",
    meta: NutritionHttpMeta,
  ): Promise<NutritionHttpSuccess<NutritionSummary>> {
    if (principal === undefined)
      throw new NutritionHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "nutrition.read", resourceFamilyId: familyId })
        : authorize({ principal, action: "nutrition.read", resourceFamilyId: familyId, membership });
    if (!decision.allowed)
      throw new NutritionHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "Nutrition data is not visible.",
      );
    return { data: await this.nutrition.getSummary(familyId, period), meta };
  }
}

export function toNutritionHttpError(
  error: unknown,
  meta: NutritionHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: NutritionHttpMeta } } {
  if (error instanceof NutritionHttpError)
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, retryable: error.retryable }, meta },
    };
  if (error instanceof NutritionValidationError)
    return {
      status: 422,
      body: { error: { code: error.code, message: "Nutrition query is invalid.", retryable: false }, meta },
    };
  return {
    status: 500,
    body: {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false },
      meta,
    },
  };
}
