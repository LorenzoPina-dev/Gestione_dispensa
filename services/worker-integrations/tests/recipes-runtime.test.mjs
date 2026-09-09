import assert from "node:assert/strict";
import { test } from "node:test";
import { RecipeConsentRequiredError, RecipeRuntimeService } from "../dist/recipes-runtime.js";

const recipe = {
  id: "recipe-1",
  title: "Pasta",
  source: "licensed-recipes",
  quality: "VERIFIED",
  servings: 2,
  ingredients: [{ name: "tomato", allergens: [] }],
};

function setup(granted = true) {
  const suggestions = new Map();
  const consumptions = [];
  const repository = {
    async getConsent() {
      return { granted, consentVersion: "consent-v1" };
    },
    async saveSuggestions(input) {
      suggestions.set(input.jobId, input.suggestions);
    },
    async getSuggestion(jobId) {
      return suggestions.get(jobId);
    },
    async recordConsumption(input) {
      consumptions.push(input);
    },
  };
  return { repository, suggestions, consumptions, service: new RecipeRuntimeService(repository) };
}

test("recipe suggestions require consent and are idempotently persisted", async () => {
  const context = setup();
  const input = {
    jobId: "recipe-job-1",
    userId: "user-1",
    recipes: [recipe],
    ranking: { availableIngredients: ["tomato"], excludedAllergens: [] },
  };
  const first = await context.service.suggest(input);
  const second = await context.service.suggest(input);
  assert.equal(first[0].recipe.id, "recipe-1");
  assert.equal(second, first);
  assert.equal(context.suggestions.size, 1);
});

test("recipe suggestions fail closed without consent", async () => {
  const context = setup(false);
  await assert.rejects(
    () =>
      context.service.suggest({
        jobId: "recipe-job-2",
        userId: "user-1",
        recipes: [recipe],
        ranking: { availableIngredients: [], excludedAllergens: [] },
      }),
    (error) => error instanceof RecipeConsentRequiredError && error.code === "CONSENT_REQUIRED",
  );
});

test("confirmed consumption uses an explicit idempotency operation", async () => {
  const context = setup();
  await context.service.confirmConsumption({
    operationId: "consume-1",
    userId: "user-1",
    familyId: "family-1",
    recipeId: "recipe-1",
    servings: 2,
    traceId: "trace-recipe-0001",
  });
  assert.equal(context.consumptions[0].operationId, "consume-1");
  await assert.rejects(
    () =>
      context.service.confirmConsumption({
        operationId: "consume-2",
        userId: "user-1",
        familyId: "family-1",
        recipeId: "recipe-1",
        servings: 0,
        traceId: "trace-recipe-0001",
      }),
    /positive/,
  );
});
