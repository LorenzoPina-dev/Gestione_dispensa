import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import {
  RecipeNotFoundError,
  RecipeService,
  RecipeValidationError,
  type Recipe,
  type RecipeMatch,
} from "./service.js";

export interface RecipeMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface RecipeHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface RecipeHttpSuccess<T> {
  data: T;
  meta: RecipeHttpMeta;
}

export class RecipeHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "RecipeHttpError";
  }
}

export class RecipeController {
  private readonly recipes: RecipeService;
  private readonly memberships: RecipeMembershipReader;

  public constructor(recipes: RecipeService, memberships: RecipeMembershipReader) {
    this.recipes = recipes;
    this.memberships = memberships;
  }

  /** Backs `GET /api/v1/recipes/suggestions?familyId=...`. Any active member may read. */
  public async listSuggestions(
    principal: Principal | undefined,
    familyId: string,
    meta: RecipeHttpMeta,
  ): Promise<RecipeHttpSuccess<{ suggestions: RecipeMatch[] }>> {
    if (principal === undefined)
      throw new RecipeHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    const suggestions = await this.recipes.listSuggestions(familyId);
    return success({ suggestions }, meta);
  }

  /** Backs `POST /api/v1/recipes/{id}/add-missing`. Requires write access (OWNER/MANAGER/MEMBER). */
  public async addMissingIngredients(
    principal: Principal | undefined,
    familyId: string,
    recipeId: string,
    traceId: string,
    meta: RecipeHttpMeta,
  ): Promise<RecipeHttpSuccess<{ itemIds: string[] }>> {
    if (principal === undefined)
      throw new RecipeHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertWrite(principal, familyId);
    try {
      const result = await this.recipes.addMissingIngredients({
        familyId,
        recipeId,
        actorId: principal.subject,
        traceId,
      });
      return success(result, meta);
    } catch (error) {
      throw toRecipeDomainError(error);
    }
  }

  /** Backs `POST /api/v1/recipes/{id}/cook`. Requires write access (OWNER/MANAGER/MEMBER). */
  public async cook(
    principal: Principal | undefined,
    familyId: string,
    recipeId: string,
    servings: number,
    traceId: string,
    meta: RecipeHttpMeta,
  ): Promise<RecipeHttpSuccess<{ movementIds: string[] }>> {
    if (principal === undefined)
      throw new RecipeHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertWrite(principal, familyId);
    try {
      const result = await this.recipes.cook({
        familyId,
        recipeId,
        servings,
        actorId: principal.subject,
        traceId,
      });
      return success(result, meta);
    } catch (error) {
      throw toRecipeDomainError(error);
    }
  }
  /** Backs `GET /api/v1/recipes?familyId=...`. Any active family member may read. */
  public async listRecipes(
    principal: Principal | undefined,
    familyId: string,
    meta: RecipeHttpMeta,
  ): Promise<RecipeHttpSuccess<{ recipes: Recipe[] }>> {
    if (principal === undefined)
      throw new RecipeHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    const recipes = await this.recipes.listRecipes();
    return success({ recipes }, meta);
  }

  /** Backs `GET /api/v1/recipes/:recipeId?familyId=...`. Any active family member may read. */
  public async getRecipe(
    principal: Principal | undefined,
    familyId: string,
    recipeId: string,
    meta: RecipeHttpMeta,
  ): Promise<RecipeHttpSuccess<{ recipe: Recipe }>> {
    if (principal === undefined)
      throw new RecipeHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    try {
      const recipe = await this.recipes.getRecipe(recipeId);
      if (recipe === undefined) throw new RecipeNotFoundError();
      return success({ recipe }, meta);
    } catch (error) {
      throw toRecipeDomainError(error);
    }
  }

  private async assertRead(principal: Principal, familyId: string): Promise<void> {
    await this.assertAction(principal, familyId, "recipes.read");
  }

  private async assertWrite(principal: Principal, familyId: string): Promise<void> {
    await this.assertAction(principal, familyId, "recipes.write");
  }

  private async assertAction(
    principal: Principal,
    familyId: string,
    action: "recipes.read" | "recipes.write",
  ): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action, resourceFamilyId: familyId })
        : authorize({ principal, action, resourceFamilyId: familyId, membership });
    if (!decision.allowed)
      throw new RecipeHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "The operation is forbidden.",
      );
  }
}

function toRecipeDomainError(error: unknown): RecipeHttpError {
  if (error instanceof RecipeNotFoundError) return new RecipeHttpError(404, error.code, error.message);
  if (error instanceof RecipeValidationError) return new RecipeHttpError(422, error.code, error.message);
  if (error instanceof RecipeHttpError) return error;
  return new RecipeHttpError(500, "INTERNAL_ERROR", "The request could not be completed.");
}

export function toRecipeHttpError(
  error: unknown,
  meta: RecipeHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: RecipeHttpMeta } } {
  const httpError = error instanceof RecipeHttpError ? error : toRecipeDomainError(error);
  return {
    status: httpError.status,
    body: {
      error: { code: httpError.code, message: httpError.message, retryable: httpError.retryable },
      meta,
    },
  };
}

function success<T>(data: T, meta: RecipeHttpMeta): RecipeHttpSuccess<T> {
  return { data, meta };
}
