import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const recipesUrl = process.env.RECIPES_TEST_URL ?? "http://127.0.0.1:3401";
const familyUrl = process.env.RECIPES_TEST_FAMILY_URL ?? "http://127.0.0.1:3311";
const inventoryUrl = process.env.RECIPES_TEST_INVENTORY_URL ?? "http://127.0.0.1:3312";
const shoppingUrl = process.env.RECIPES_TEST_SHOPPING_URL ?? "http://127.0.0.1:3313";
const databaseUrl = process.env.RECIPES_TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("RECIPES_TEST_DATABASE_URL is required. Integration uses real Recipes, Family, Inventory, Shopping and PostgreSQL.");
}

const pool = new Pool({ connectionString: databaseUrl });
const userId = randomUUID();
const familyName = "recipes-integration-" + Date.now() + "-" + randomUUID().slice(0, 8);
const productId = randomUUID();

let familyId: string | undefined;
let recipeId: string | undefined;
let recipeVersion = 1;
let shoppingListId: string | undefined;

async function request(base: string, path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

function headers() {
  return { "x-user-id": userId, "x-family-id": familyId ?? "" };
}

before(async () => {
  for (const [url, name] of [
    [recipesUrl, "recipes"],
    [familyUrl, "family"],
    [inventoryUrl, "inventory"],
    [shoppingUrl, "shopping"],
  ] as const) {
    const health = await request(url, "/health/ready");
    assert.equal(health.response.status, 200, name + " must be ready");
  }

  const family = await request(familyUrl, "/api/v1/families", {
    method: "POST",
    headers: { "x-user-id": userId, "content-type": "application/json", "x-idempotency-key": "family-" + randomUUID() },
    body: JSON.stringify({ name: familyName }),
  });
  assert.equal(family.response.status, 201);
  familyId = family.body?.data?.familyId;
  assert.ok(familyId);
});

after(async () => {
  if (familyId) {
    const recipes = await pool.query("SELECT id FROM recipes_domain.recipes WHERE family_id=$1", [familyId]);
    for (const row of recipes.rows) {
      await pool.query("DELETE FROM recipes_domain.recipes WHERE id=$1", [row.id]);
    }
  }
  await pool.end();
  if (familyId) {
    const family = await request(familyUrl, "/api/v1/families/" + familyId, { headers: { "x-user-id": userId } });
    if (family.response.status === 200) {
      await request(familyUrl, "/api/v1/families/" + familyId, {
        method: "DELETE",
        headers: {
          "x-user-id": userId,
          "x-idempotency-key": "cleanup-family-" + randomUUID(),
          "if-match": String(family.body?.data?.version),
        },
      });
    }
  }
});

describe("service-recipes / real lifecycle", () => {
  it("creates a recipe with ingredients and ordered steps", async () => {
    assert.ok(familyId);
    const created = await request(recipesUrl, "/api/v1/recipes", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "create-recipe-" + randomUUID() },
      body: JSON.stringify({
        title: "Pasta integration",
        servings: 2,
        ingredients: [
          { productId, name: "Farina", quantity: 500, unit: "g" },
          { productId: randomUUID(), name: "Latte", quantity: 1, unit: "l" },
        ],
        steps: ["Mescolare", "Cuocere"],
      }),
    });

    assert.equal(created.response.status, 201);
    recipeId = created.body?.data?.recipeId;
    recipeVersion = Number(created.body?.version);
    assert.ok(recipeId);
    assert.equal(recipeVersion, 1);
    assert.deepEqual(created.body?.data?.steps, ["Mescolare", "Cuocere"]);
  });

  it("lists, searches and reads the same persisted recipe", async () => {
    assert.ok(familyId && recipeId);
    const list = await request(recipesUrl, "/api/v1/recipes?familyId=" + familyId + "&q=Pasta", {
      headers: { "x-user-id": userId },
    });
    assert.equal(list.response.status, 200);
    assert.ok(list.body?.items?.some((entry: any) => entry.recipeId === recipeId));

    const detail = await request(recipesUrl, "/api/v1/recipes/" + recipeId + "?familyId=" + familyId, {
      headers: { "x-user-id": userId },
    });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body?.data?.recipeId, recipeId);
    assert.equal(detail.body?.data?.ingredients?.length, 2);
  });

  it("updates the recipe and rejects stale optimistic-lock versions", async () => {
    assert.ok(recipeId && familyId);
    const updated = await request(recipesUrl, "/api/v1/recipes/" + recipeId, {
      method: "PATCH",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "update-recipe-" + randomUUID(), "if-match": "1" },
      body: JSON.stringify({
        title: "Pasta integration aggiornata",
        servings: 3,
        steps: ["Preparare", "Cuocere", "Servire"],
      }),
    });
    assert.equal(updated.response.status, 200);
    recipeVersion = Number(updated.body?.version);
    assert.equal(recipeVersion, 2);

    const stale = await request(recipesUrl, "/api/v1/recipes/" + recipeId, {
      method: "PATCH",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "stale-recipe-" + randomUUID(), "if-match": "1" },
      body: JSON.stringify({ title: "Non deve applicarsi" }),
    });
    assert.equal(stale.response.status, 412);
    assert.equal(stale.body?.error?.code, "PRECONDITION_FAILED");
  });

  it("returns recipe suggestions from the same real persistence", async () => {
    assert.ok(familyId);
    const suggestions = await request(recipesUrl, "/api/v1/recipes/suggestions?familyId=" + familyId, {
      headers: { "x-user-id": userId },
    });
    assert.equal(suggestions.response.status, 200);
    assert.ok(suggestions.body?.items?.some((entry: any) => entry.recipeId === recipeId));
    assert.equal(suggestions.body?.items?.find((entry: any) => entry.recipeId === recipeId)?.score, 1);
  });

  it("uses real Inventory and Shopping for add-missing", async () => {
    assert.ok(familyId && recipeId);

    const addedStock = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "stock-" + randomUUID() },
      body: JSON.stringify({ productId, quantity: 100, unit: "g", location: "pantry" }),
    });
    assert.equal(addedStock.response.status, 201);

    const result = await request(recipesUrl, "/api/v1/recipes/" + recipeId + "/add-missing", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "missing-" + randomUUID() },
      body: JSON.stringify({ familyId }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(Array.isArray(result.body?.data?.itemIds), true);
    assert.ok(result.body?.data?.itemIds?.length >= 1);

    const lists = await request(shoppingUrl, "/api/v1/shopping/lists?familyId=" + familyId, {
      headers: { "x-user-id": userId },
    });
    assert.equal(lists.response.status, 200);
    const list = lists.body?.items?.find((entry: any) => entry.status === "open");
    assert.ok(list);
    shoppingListId = list.listId;

    const detail = await request(shoppingUrl, "/api/v1/shopping/lists/" + shoppingListId + "?familyId=" + familyId, {
      headers: { "x-user-id": userId },
    });
    assert.equal(detail.response.status, 200);
    assert.ok(detail.body?.data?.items?.some((entry: any) => entry.label === "Farina"));
  });

  it("does not duplicate add-missing on idempotent replay", async () => {
    assert.ok(familyId && recipeId);
    const key = "missing-replay-" + randomUUID();
    const payload = JSON.stringify({ familyId });
    const init = {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": key },
      body: payload,
    };
    const first = await request(recipesUrl, "/api/v1/recipes/" + recipeId + "/add-missing", init);
    const second = await request(recipesUrl, "/api/v1/recipes/" + recipeId + "/add-missing", init);
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.deepEqual(second.body, first.body);
  });

  it("deletes the recipe and removes its dependent rows", async () => {
    assert.ok(recipeId && familyId);
    const deleted = await request(recipesUrl, "/api/v1/recipes/" + recipeId, {
      method: "DELETE",
      headers: { ...headers(), "x-idempotency-key": "delete-recipe-" + randomUUID(), "if-match": String(recipeVersion) },
    });
    assert.equal(deleted.response.status, 204);

    const db = await pool.query("SELECT count(*)::int AS count FROM recipes_domain.recipes WHERE id=$1", [recipeId]);
    const ingredients = await pool.query("SELECT count(*)::int AS count FROM recipes_domain.recipe_ingredients WHERE recipe_id=$1", [recipeId]);
    const steps = await pool.query("SELECT count(*)::int AS count FROM recipes_domain.recipe_steps WHERE recipe_id=$1", [recipeId]);
    assert.equal(db.rows[0].count, 0);
    assert.equal(ingredients.rows[0].count, 0);
    assert.equal(steps.rows[0].count, 0);
  });
});
