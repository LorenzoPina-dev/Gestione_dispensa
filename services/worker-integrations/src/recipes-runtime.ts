import {
  calculateNutrition,
  rankRecipes,
  type NutritionProfile,
  type NutritionResult,
  type RecipeDefinition,
  type RecipeRankingInput,
  type RankedRecipe,
} from "./recipes-nutrition.js";

export interface RecipeRuntimeRepository {
  getConsent(
    userId: string,
    purpose: "recipe.personalization",
  ): Promise<{
    readonly granted: boolean;
    readonly consentVersion: string;
  }>;
  saveSuggestions(input: {
    readonly jobId: string;
    readonly userId: string;
    readonly suggestions: readonly RankedRecipe[];
    readonly consentVersion: string;
  }): Promise<void>;
  getSuggestion(jobId: string): Promise<readonly RankedRecipe[] | undefined>;
  recordConsumption(input: {
    readonly operationId: string;
    readonly userId: string;
    readonly familyId: string;
    readonly recipeId: string;
    readonly servings: number;
    readonly traceId: string;
  }): Promise<void>;
}

export class RecipeConsentRequiredError extends Error {
  public readonly code = "CONSENT_REQUIRED";

  public constructor() {
    super("Recipe personalization consent is required.");
    this.name = "RecipeConsentRequiredError";
  }
}

export class RecipeRuntimeService {
  private readonly repository: RecipeRuntimeRepository;

  public constructor(repository: RecipeRuntimeRepository) {
    this.repository = repository;
  }

  public async suggest(input: {
    readonly jobId: string;
    readonly userId: string;
    readonly recipes: readonly RecipeDefinition[];
    readonly ranking: RecipeRankingInput;
  }): Promise<readonly RankedRecipe[]> {
    const existing = await this.repository.getSuggestion(input.jobId);
    if (existing !== undefined) return existing;
    const consent = await this.repository.getConsent(input.userId, "recipe.personalization");
    if (!consent.granted) throw new RecipeConsentRequiredError();
    const suggestions = rankRecipes(input.recipes, input.ranking);
    await this.repository.saveSuggestions({
      jobId: input.jobId,
      userId: input.userId,
      suggestions,
      consentVersion: consent.consentVersion,
    });
    return suggestions;
  }

  public calculateNutrition(
    profile: NutritionProfile | undefined,
    requestedQuantity: number,
  ): NutritionResult {
    return calculateNutrition(profile, requestedQuantity);
  }

  public async confirmConsumption(input: {
    readonly operationId: string;
    readonly userId: string;
    readonly familyId: string;
    readonly recipeId: string;
    readonly servings: number;
    readonly traceId: string;
  }): Promise<void> {
    if (!Number.isFinite(input.servings) || input.servings <= 0) {
      throw new Error("Consumed servings must be positive.");
    }
    await this.repository.recordConsumption(input);
  }
}
