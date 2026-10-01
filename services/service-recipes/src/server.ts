import express from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const port = Number(process.env.PORT ?? 3401);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Body = Record<string, unknown>;

const errorBody = (code: string, message: string) => ({
  error: { code, message, details: [], requestId: crypto.randomUUID() },
});

function context(req: express.Request): { userId: string; familyId: string } | null {
  const userId = String(req.header("x-user-id") ?? "").trim();
  const familyId = String(req.query.familyId ?? req.body?.familyId ?? req.header("x-family-id") ?? "").trim();
  return userId && familyId ? { userId, familyId } : null;
}

function key(req: express.Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

function match(req: express.Request): number | null {
  const value = req.header("if-match");
  if (!value) return null;
  const parsed = Number(value.replace(/^W\/?/i, "").replace(/"/g, ""));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function beginIdempotency(
  client: PoolClient,
  req: express.Request,
  userId: string,
  familyId: string,
  body: unknown,
) {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return { kind: "missing" as const };
  const requestHash = hash(body);
  const existing = await client.query(
    "select actor_user_id,family_id,request_hash,status,response_status,response_body from recipes_domain.idempotency_keys where key=$1 for update",
    [idempotencyKey],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.actor_user_id !== userId || row.family_id !== familyId || row.request_hash !== requestHash) {
      return { kind: "conflict" as const };
    }
    if (row.status === "completed") {
      return { kind: "replay" as const, status: Number(row.response_status), response: row.response_body };
    }
    return { kind: "new" as const };
  }
  await client.query(
    `insert into recipes_domain.idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')`,
    [idempotencyKey, userId, familyId, requestHash],
  );
  return { kind: "new" as const };
}

async function finishIdempotency(client: PoolClient, req: express.Request, status: number, response: unknown): Promise<void> {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return;
  await client.query(
    "update recipes_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [idempotencyKey, status, JSON.stringify(response)],
  );
}

async function outbox(client: PoolClient, eventType: string, aggregateId: string, familyId: string, userId: string, payload: unknown): Promise<void> {
  await client.query(
    `insert into recipes_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,$4,$5,now(),$6::jsonb,now())`,
    [crypto.randomUUID(), eventType, aggregateId, familyId, userId, JSON.stringify(payload)],
  );
}

async function init(): Promise<void> {
  await pool.query("select 1");
}

app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "service-recipes" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ready", service: "service-recipes" });
  } catch {
    res.status(503).json({ status: "not_ready", service: "service-recipes" });
  }
});

app.get("/api/v1/recipes", async (req, res) => {
  const ctx = context(req);
  if (!ctx) return res.status(400).json(errorBody("VALIDATION_ERROR", "familyId is required."));
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const q = String(req.query.q ?? "").trim();
  const result = await pool.query(
    `select id,title,servings,version from recipes_domain.recipes
     where family_id=$1 and ($2='' or title ilike '%'||$2||'%')
     order by created_at desc limit $3`,
    [ctx.familyId, q, limit],
  );
  const items = await Promise.all(result.rows.map(async (row) => {
    const full = await loadRecipe(String(row.id), ctx.familyId);
    return full ?? { recipeId: row.id, title: row.title, servings: Number(row.servings), ingredients: [], steps: [], version: Number(row.version) };
  }));
  return res.json({ items, nextCursor: null });
});

app.post("/api/v1/recipes", async (req, res) => {
  const ctx = context(req);
  const body = req.body as Body;
  if (!ctx || !key(req)) return res.status(400).json(errorBody("VALIDATION_ERROR", "familyId and X-Idempotency-Key are required."));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const servings = Number(body.servings);
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!title || !Number.isFinite(servings) || servings <= 0 || !ingredients.every((x) => typeof x === "object" && x !== null) || !steps.every((x) => typeof x === "string")) {
    return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid recipe payload."));
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, ctx.userId, ctx.familyId, body);
    if (idem.kind === "missing" || idem.kind === "conflict") {
      await client.query("rollback");
      return res.status(idem.kind === "conflict" ? 409 : 400).json(errorBody(idem.kind === "conflict" ? "CONFLICT" : "VALIDATION_ERROR", idem.kind === "conflict" ? "Idempotency key conflict." : "X-Idempotency-Key is required."));
    }
    if (idem.kind === "replay") {
      await client.query("commit");
      return res.status(idem.status).json(idem.response);
    }
    const id = crypto.randomUUID();
    const recipe = await client.query(
      "insert into recipes_domain.recipes(id,owner_user_id,family_id,title,servings) values($1,$2,$3,$4,$5) returning *",
      [id, ctx.userId, ctx.familyId, title, servings],
    );
    for (const [index, raw] of ingredients.entries()) {
      const item = raw as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const quantity = Number(item.quantity);
      const unit = typeof item.unit === "string" ? item.unit : "";
      if (!name || !Number.isFinite(quantity) || quantity <= 0 || !unit) {
        await client.query("rollback");
        return res.status(400).json(errorBody("VALIDATION_ERROR", `ingredients[${index}] is invalid.`));
      }
      await client.query(
        "insert into recipes_domain.recipe_ingredients(id,recipe_id,product_id,name,quantity,unit) values($1,$2,$3,$4,$5,$6)",
        [crypto.randomUUID(), id, item.productId ?? null, name, quantity, unit],
      );
    }
    for (const [position, instruction] of steps.entries()) {
      await client.query(
        "insert into recipes_domain.recipe_steps(id,recipe_id,position,instruction) values($1,$2,$3,$4)",
        [crypto.randomUUID(), id, position + 1, instruction],
      );
    }
    const full = await client.query("select version from recipes_domain.recipes where id=$1",[id]);
    const response = { data: { ...(await loadRecipeFromClient(client,id,ctx.familyId)), version: Number(full.rows[0].version) }, version: Number(full.rows[0].version) };
    await outbox(client,"RecipeCreated",id,ctx.familyId,ctx.userId,response);
    await finishIdempotency(client,req,201,response);
    await client.query("commit");
    return res.status(201).json(response);
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json(errorBody("INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to create recipe."));
  } finally { client.release(); }
});

app.get("/api/v1/recipes/:recipeId", async (req,res) => {
  const ctx = context(req);
  if (!ctx) return res.status(400).json(errorBody("VALIDATION_ERROR","familyId is required."));
  const recipe = await loadRecipe(req.params.recipeId,ctx.familyId);
  if (!recipe) return res.status(404).json(errorBody("NOT_FOUND","Recipe not found."));
  return res.json({ data: recipe });
});

app.patch("/api/v1/recipes/:recipeId", async (req,res) => {
  const ctx=context(req); const version=match(req);
  if(!ctx||!key(req)||version===null)return res.status(400).json(errorBody("VALIDATION_ERROR","familyId, X-Idempotency-Key and If-Match are required."));
  const body=req.body as Body; const client=await pool.connect();
  try{await client.query("begin");const idem=await beginIdempotency(client,req,ctx.userId,ctx.familyId,body);if(idem.kind!=="new"){await client.query("rollback");return res.status(idem.kind==="conflict"?409:400).json(errorBody(idem.kind==="conflict"?"CONFLICT":"VALIDATION_ERROR","Invalid idempotency state."));}
    const current=await client.query("select * from recipes_domain.recipes where id=$1 and family_id=$2 for update",[req.params.recipeId,ctx.familyId]);
    if(!current.rowCount){await client.query("rollback");return res.status(404).json(errorBody("NOT_FOUND","Recipe not found."));}
    if(Number(current.rows[0].version)!==version){await client.query("rollback");return res.status(412).json(errorBody("PRECONDITION_FAILED","Recipe version changed."));}
    const title=Object.hasOwn(body,"title")?String(body.title).trim():String(current.rows[0].title);
    const servings=Object.hasOwn(body,"servings")?Number(body.servings):Number(current.rows[0].servings);
    if(!title||!Number.isFinite(servings)||servings<=0){await client.query("rollback");return res.status(400).json(errorBody("VALIDATION_ERROR","Invalid recipe values."));}
    await client.query("update recipes_domain.recipes set title=$2,servings=$3,version=version+1,updated_at=now() where id=$1",[req.params.recipeId,title,servings]);
    if(Object.hasOwn(body,"ingredients")){
      if(!Array.isArray(body.ingredients)){await client.query("rollback");return res.status(400).json(errorBody("VALIDATION_ERROR","ingredients must be an array."));}
      await client.query("delete from recipes_domain.recipe_ingredients where recipe_id=$1",[req.params.recipeId]);
      for(const raw of body.ingredients){const item=raw as Record<string,unknown>;const name=typeof item.name==="string"?item.name.trim():"";const q=Number(item.quantity);const unit=typeof item.unit==="string"?item.unit:"";if(!name||!Number.isFinite(q)||q<=0||!unit){await client.query("rollback");return res.status(400).json(errorBody("VALIDATION_ERROR","Invalid ingredient."));}await client.query("insert into recipes_domain.recipe_ingredients(id,recipe_id,product_id,name,quantity,unit) values($1,$2,$3,$4,$5,$6)",[crypto.randomUUID(),req.params.recipeId,item.productId??null,name,q,unit]);}
    }
    if(Object.hasOwn(body,"steps")){if(!Array.isArray(body.steps)||!body.steps.every((x)=>typeof x==="string")){await client.query("rollback");return res.status(400).json(errorBody("VALIDATION_ERROR","steps must be an array of strings."));}await client.query("delete from recipes_domain.recipe_steps where recipe_id=$1",[req.params.recipeId]);for(const [pos,instruction] of (body.steps as string[]).entries())await client.query("insert into recipes_domain.recipe_steps(id,recipe_id,position,instruction) values($1,$2,$3,$4)",[crypto.randomUUID(),req.params.recipeId,pos+1,instruction]);}
    const full=await loadRecipeFromClient(client,req.params.recipeId,ctx.familyId);const response={data:full,version:full.version};await outbox(client,"RecipeUpdated",req.params.recipeId,ctx.familyId,ctx.userId,response);await finishIdempotency(client,req,200,response);await client.query("commit");return res.json(response);
  }catch(error){await client.query("rollback");return res.status(500).json(errorBody("INTERNAL_ERROR",error instanceof Error?error.message:"Unable to update recipe."));}finally{client.release();}
});

app.delete("/api/v1/recipes/:recipeId",async(req,res)=>{
  const ctx=context(req);const version=match(req);if(!ctx||!key(req)||version===null)return res.status(400).json(errorBody("VALIDATION_ERROR","familyId, X-Idempotency-Key and If-Match are required."));
  const client=await pool.connect();try{await client.query("begin");const idem=await beginIdempotency(client,req,ctx.userId,ctx.familyId,{recipeId:req.params.recipeId});if(idem.kind!=="new"){await client.query("rollback");return res.status(idem.kind==="conflict"?409:400).json(errorBody(idem.kind==="conflict"?"CONFLICT":"VALIDATION_ERROR","Invalid idempotency state."));}
    const current=await client.query("select version from recipes_domain.recipes where id=$1 and family_id=$2 for update",[req.params.recipeId,ctx.familyId]);if(!current.rowCount){await client.query("rollback");return res.status(404).json(errorBody("NOT_FOUND","Recipe not found."));}if(Number(current.rows[0].version)!==version){await client.query("rollback");return res.status(412).json(errorBody("PRECONDITION_FAILED","Recipe version changed."));}
    await client.query("delete from recipes_domain.recipes where id=$1",[req.params.recipeId]);await outbox(client,"RecipeDeleted",req.params.recipeId,ctx.familyId,ctx.userId,{recipeId:req.params.recipeId});await finishIdempotency(client,req,204,null);await client.query("commit");return res.status(204).end();
  }catch(error){await client.query("rollback");return res.status(500).json(errorBody("INTERNAL_ERROR",error instanceof Error?error.message:"Unable to delete recipe."));}finally{client.release();}
});

app.get("/api/v1/recipes/suggestions",async(req,res)=>{
  const ctx=context(req);if(!ctx)return res.status(400).json(errorBody("VALIDATION_ERROR","familyId is required."));
  const q=await pool.query("select id from recipes_domain.recipes where family_id=$1 order by updated_at desc limit $2",[ctx.familyId,Math.min(Math.max(Number(req.query.limit??20),1),100)]);
  const items=await Promise.all(q.rows.map(async row=>{const recipe=await loadRecipe(String(row.id),ctx.familyId);return {recipeId:recipe?.recipeId??String(row.id),score:1,missingIngredients:[]};}));
  return res.json({items});
});

app.use((_req,res)=>res.status(404).json(errorBody("NOT_FOUND","Route not found.")));

async function loadRecipeFromClient(client: PoolClient,id:string,familyId:string){
  const recipeResult=await client.query("select id,title,servings,version from recipes_domain.recipes where id=$1 and family_id=$2",[id,familyId]);
  const recipe=recipeResult.rows[0]; if(!recipe) throw new Error("Recipe not found.");
  const [ingredients,steps]=await Promise.all([
    client.query("select product_id,name,quantity,unit from recipes_domain.recipe_ingredients where recipe_id=$1 order by created_at",[id]),
    client.query("select position,instruction from recipes_domain.recipe_steps where recipe_id=$1 order by position",[id]),
  ]);
  return {recipeId:recipe.id,title:recipe.title,servings:Number(recipe.servings),ingredients:ingredients.rows.map(x=>({productId:x.product_id,name:x.name,quantity:Number(x.quantity),unit:x.unit})),steps:steps.rows.map(x=>x.instruction),version:Number(recipe.version)};
}

init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-recipes",port})))).catch(e=>{console.error(e);process.exit(1)});
