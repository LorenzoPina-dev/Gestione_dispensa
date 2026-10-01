import express, { type Request } from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";

type Context = { userId: string; familyId: string };
type Body = Record<string, unknown>;
type Ingredient = { productId?: string | null; name: string; quantity: number; unit: string };
type Stock = { productId?: string; quantity?: number; unit?: string };

function context(req: Request): Context | null {
  const userId = String(req.header("x-user-id") ?? "").trim();
  const familyId = String(req.query.familyId ?? req.body?.familyId ?? req.header("x-family-id") ?? "").trim();
  return userId && familyId ? { userId, familyId } : null;
}

function idempotencyKey(req: Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function childKey(parent: string, suffix: string): string {
  return crypto.createHash("sha256").update(parent + ":" + suffix).digest("hex").slice(0, 64);
}

function unitInfo(unit: string): { family: "mass" | "volume" | "count"; factor: number } | null {
  switch (unit.toLowerCase()) {
    case "kg": return { family: "mass", factor: 1000 };
    case "g": return { family: "mass", factor: 1 };
    case "l": return { family: "volume", factor: 1000 };
    case "ml": return { family: "volume", factor: 1 };
    case "piece": return { family: "count", factor: 1 };
    case "pack": return { family: "count", factor: 1 };
    default: return null;
  }
}

function errorBody(code: string, message: string) {
  const retryable = new Set(["UPSTREAM_ERROR", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]).has(code);
  return {
    error: { code, message, details: [], retryable, requestId: crypto.randomUUID() },
    meta: { requestId: crypto.randomUUID(), traceId: crypto.randomUUID(), schemaVersion: "1.0" },
  };
}

async function loadIngredients(pool: Pool, recipeId: string, familyId: string): Promise<Ingredient[] | null> {
  const recipe = await pool.query(
    "select id from recipes_domain.recipes where id=$1 and family_id=$2",
    [recipeId, familyId],
  );
  if (!recipe.rowCount) return null;
  const rows = await pool.query(
    "select product_id,name,quantity,unit from recipes_domain.recipe_ingredients where recipe_id=$1 order by created_at",
    [recipeId],
  );
  return rows.rows.map((row) => ({
    productId: row.product_id,
    name: String(row.name),
    quantity: Number(row.quantity),
    unit: String(row.unit),
  }));
}

async function readJson(response: globalThis.Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function remote(
  base: string,
  path: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<{ response: globalThis.Response; payload: unknown }> {
  const response = await fetch(base + path, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
  return { response, payload: await readJson(response) };
}

async function claim(
  pool: Pool,
  req: Request,
  ctx: Context,
  operation: Body,
): Promise<{ kind: "new" | "replay" | "processing" | "conflict"; status?: number; response?: unknown }> {
  const key = idempotencyKey(req);
  if (!key) return { kind: "conflict" };
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      "select actor_user_id,family_id,request_hash,status,response_status,response_body from recipes_domain.idempotency_keys where key=$1 for update",
      [key],
    );
    const requestHash = hash(operation);
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (String(row.actor_user_id) !== ctx.userId || String(row.family_id) !== ctx.familyId || row.request_hash !== requestHash) {
        await client.query("rollback");
        return { kind: "conflict" };
      }
      if (row.status === "completed" && row.response_status !== null) {
        await client.query("commit");
        return { kind: "replay", status: Number(row.response_status), response: row.response_body };
      }
      if (row.status === "processing") {
        await client.query("rollback");
        return { kind: "processing" };
      }
      await client.query(
        "update recipes_domain.idempotency_keys set status='processing',response_status=null,response_body=null where key=$1",
        [key],
      );
    } else {
      await client.query(
        "insert into recipes_domain.idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at) values($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')",
        [key, ctx.userId, ctx.familyId, requestHash],
      );
    }
    await client.query("commit");
    return { kind: "new" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function setIdempotency(pool: Pool, req: Request, status: "completed" | "failed", response?: unknown): Promise<void> {
  const key = idempotencyKey(req);
  if (!key) return;
  if (status === "completed") {
    await pool.query(
      "update recipes_domain.idempotency_keys set status='completed',response_status=200,response_body=$2 where key=$1",
      [key, JSON.stringify(response)],
    );
  } else {
    await pool.query("update recipes_domain.idempotency_keys set status='failed' where key=$1", [key]);
  }
}

export function registerAddMissingIngredientsRoute(app: express.Express, pool: Pool): void {
  app.post("/api/v1/recipes/:recipeId/add-missing", async (req, res) => {
    const ctx = context(req);
    const key = idempotencyKey(req);
    if (!ctx || !key) return res.status(400).json(errorBody("VALIDATION_ERROR", "familyId and X-Idempotency-Key are required."));

    const operation: Body = {
      recipeId: req.params.recipeId,
      familyId: ctx.familyId,
      operation: "add-missing",
    };

    try {
      const claimed = await claim(pool, req, ctx, operation);
      if (claimed.kind === "conflict") return res.status(409).json(errorBody("CONFLICT", "Idempotency key conflict."));
      if (claimed.kind === "processing") return res.status(409).json(errorBody("CONFLICT", "The same operation is already processing."));
      if (claimed.kind === "replay") return res.status(claimed.status ?? 200).json(claimed.response);

      const ingredients = await loadIngredients(pool, req.params.recipeId, ctx.familyId);
      if (!ingredients) {
        await setIdempotency(pool, req, "failed");
        return res.status(404).json(errorBody("NOT_FOUND", "Recipe not found."));
      }

      const inventoryBase = (process.env.INVENTORY_SERVICE_BASE_URL ?? "http://service-inventory:3312/api/v1").replace(/\/$/, "");
      const shoppingBase = (process.env.SHOPPING_SERVICE_BASE_URL ?? "http://service-shopping:3313/api/v1").replace(/\/$/, "");
      const headers: Record<string, string> = {
        accept: "application/json",
        "x-user-id": ctx.userId,
        "x-family-id": ctx.familyId,
      };
      const authorization = req.header("authorization");
      if (authorization) headers.authorization = authorization;

      const inventory = await remote(
        inventoryBase,
        "/inventory?familyId=" + encodeURIComponent(ctx.familyId),
        headers,
      );
      if (!inventory.response.ok || !Array.isArray((inventory.payload as { items?: unknown[] } | null)?.items)) {
        await setIdempotency(pool, req, "failed");
        return res.status(502).json(errorBody("UPSTREAM_ERROR", "Inventory service could not be read."));
      }

      const stock = (inventory.payload as { items: Stock[] }).items;
      const needs: Array<{ ingredient: Ingredient; quantity: number; index: number }> = [];

      ingredients.forEach((ingredient, index) => {
        const target = unitInfo(ingredient.unit);
        if (!target || ingredient.quantity <= 0) return;

        let availableBase = 0;
        if (ingredient.productId) {
          for (const item of stock) {
            if (String(item.productId ?? "") !== String(ingredient.productId)) continue;
            const source = unitInfo(String(item.unit ?? ""));
            if (!source || source.family !== target.family) continue;
            availableBase += Number(item.quantity ?? 0) * source.factor;
          }
        }

        const deficitBase = Math.max(0, ingredient.quantity * target.factor - availableBase);
        if (deficitBase > 0) {
          needs.push({
            ingredient,
            quantity: Number((deficitBase / target.factor).toFixed(3)),
            index,
          });
        }
      });

      if (needs.length === 0) {
        const response = { data: { itemIds: [] }, version: 1 };
        await setIdempotency(pool, req, "completed", response);
        return res.status(200).json(response);
      }

      const lists = await remote(
        shoppingBase,
        "/shopping/lists?familyId=" + encodeURIComponent(ctx.familyId),
        headers,
      );
      if (!lists.response.ok || !Array.isArray((lists.payload as { items?: unknown[] } | null)?.items)) {
        await setIdempotency(pool, req, "failed");
        return res.status(502).json(errorBody("UPSTREAM_ERROR", "Shopping service could not be read."));
      }

      let active = (lists.payload as { items: Array<{ listId: string; status: string }> }).items.find((item) => item.status === "open");
      if (!active) {
        const created = await remote(
          shoppingBase,
          "/shopping/lists",
          { ...headers, "content-type": "application/json", "x-idempotency-key": childKey(key, "shopping-list") },
          { method: "POST", body: JSON.stringify({ familyId: ctx.familyId, name: "Spesa da ricette" }) },
        );
        const createdData = (created.payload as { data?: { listId?: string } } | null)?.data;
        if (!created.response.ok || !createdData?.listId) {
          await setIdempotency(pool, req, "failed");
          return res.status(502).json(errorBody("UPSTREAM_ERROR", "Shopping list could not be created."));
        }
        active = { listId: String(createdData.listId), status: "open" };
      }

      const itemIds: string[] = [];
      for (const need of needs) {
        const added = await remote(
          shoppingBase,
          "/shopping/lists/" + encodeURIComponent(active.listId) + "/items",
          { ...headers, "content-type": "application/json", "x-idempotency-key": childKey(key, "ingredient-" + need.index) },
          {
            method: "POST",
            body: JSON.stringify({
              familyId: ctx.familyId,
              productId: need.ingredient.productId ?? null,
              label: need.ingredient.name,
              quantity: need.quantity,
              unit: need.ingredient.unit,
              source: "recipe",
            }),
          },
        );
        const addedData = (added.payload as { data?: { itemId?: string } } | null)?.data;
        if (!added.response.ok || !addedData?.itemId) {
          await setIdempotency(pool, req, "failed");
          return res.status(502).json(errorBody("UPSTREAM_ERROR", "Shopping item could not be added."));
        }
        itemIds.push(String(addedData.itemId));
      }

      const response = { data: { itemIds }, version: 1 };
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "insert into recipes_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,causation_id,occurred_at,payload,created_at) values($1,$2,1,$3,$4,$5,$6,now(),$7::jsonb,now())",
          [crypto.randomUUID(), "RecipeMissingIngredientsAddedToShopping", req.params.recipeId, ctx.familyId, crypto.randomUUID(), idempotencyKey(req), JSON.stringify(response)],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      await setIdempotency(pool, req, "completed", response);
      return res.status(200).json(response);
    } catch (error) {
      await setIdempotency(pool, req, "failed").catch(() => undefined);
      return res.status(502).json(errorBody("UPSTREAM_ERROR", error instanceof Error ? error.message : "Recipe shopping orchestration failed."));
    }
  });
}
