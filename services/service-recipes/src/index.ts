import express, { type Request } from "express";
import crypto from "node:crypto";
import { Pool } from "pg";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT ?? 3401);
const schema = "recipes_domain";
const inventoryBase = (process.env.INVENTORY_SERVICE_BASE_URL ?? "http://service-inventory:3312/api/v1").replace(/\/$/, "");
const shoppingBase = (process.env.SHOPPING_SERVICE_BASE_URL ?? "http://service-shopping:3313/api/v1").replace(/\/$/, "");
const timeoutMs = Number(process.env.CORE_API_TIMEOUT_MS ?? 5000);

type Ingredient = { id: string; productId?: string; displayName: string; amount: number; unit: string; allergens: string[] };
type Recipe = { id: string; familyId?: string; title: string; description?: string; source?: string; quality?: string; servings: number; prepTimeMin: number; cookTimeMin: number; difficulty: string; imageUrl?: string; tags: string[]; caloriesPerServing?: number; ingredients: Ingredient[] };

app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "service-recipes" }));
app.get("/health/ready", async (_req, res) => { try { await pool.query("select 1"); res.json({ status: "ok", db: true }); } catch { res.status(503).json({ status: "not_ready", db: false }); } });

async function recipe(id: string): Promise<Recipe | undefined> {
  const q = await pool.query(`select r.*, coalesce(json_agg(json_build_object('id',i.id,'productId',i.product_id,'displayName',i.display_name,'amount',i.amount,'unit',i.unit,'allergens',coalesce(i.allergens,'{}')) order by i.position) filter(where i.id is not null),'[]') ingredients from ${schema}.recipes r left join ${schema}.recipe_ingredients i on i.recipe_id=r.id where r.id=$1 group by r.id`, [id]);
  return q.rows[0] as Recipe | undefined;
}
async function list(): Promise<Recipe[]> {
  const q = await pool.query(`select r.*, coalesce(json_agg(json_build_object('id',i.id,'productId',i.product_id,'displayName',i.display_name,'amount',i.amount,'unit',i.unit,'allergens',coalesce(i.allergens,'{}')) order by i.position) filter(where i.id is not null),'[]') ingredients from ${schema}.recipes r left join ${schema}.recipe_ingredients i on i.recipe_id=r.id where r.status='ACTIVE' group by r.id order by r.created_at desc limit 200`);
  return q.rows as Recipe[];
}
async function core(path: string, authorization: string | undefined, init: RequestInit = {}) {
  const base = path.startsWith("/inventory") ? inventoryBase : shoppingBase;
  const url = new URL(base + path);
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(authorization ? { authorization } : {}) }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Core request failed"), { status: response.status, body });
  return body?.data ?? body;
}
function familyId(req: Request) { return String(req.query.familyId ?? req.body?.familyId ?? "").trim(); }

app.get("/api/v1/recipes", async (req,res,next) => { try { const all = await list(); const fid = familyId(req); res.json({ data: all.filter(r => !r.familyId || r.familyId === fid) }); } catch(e){next(e);} });
app.get("/api/v1/recipes/suggestions", async (req,res,next) => { try {
  const fid = familyId(req); if (!fid) return res.status(400).json({ error:{code:"VALIDATION_ERROR",message:"familyId is required"} });
  const [recipes, stock] = await Promise.all([list(), core(`/inventory/stock-items?familyId=${encodeURIComponent(fid)}`, req.header("authorization") ?? undefined)]);
  const ids = new Set((stock?.items ?? []).map((x:any)=>x.productId));
  const suggestions = recipes.map(r => { const matched=r.ingredients.filter(i=>i.productId && ids.has(i.productId)); return { ...r, matchPercentage: Math.round(matched.length / Math.max(r.ingredients.length,1) * 100), matchedIngredientNames: matched.map(i=>i.displayName), missingIngredients:r.ingredients.filter(i=>!i.productId || !ids.has(i.productId)) }; }).sort((a,b)=>b.matchPercentage-a.matchPercentage);
  res.json({data:{suggestions}});
} catch(e){next(e);} });
app.get("/api/v1/recipes/:id", async(req,res,next)=>{try{const r=await recipe(req.params.id); if(!r)return res.status(404).json({error:{code:"NOT_FOUND"}});res.json({data:r});}catch(e){next(e);}});
app.post("/api/v1/recipes", async(req,res,next)=>{const b=req.body??{}; const c=await pool.connect(); try{await c.query("begin");const r=await c.query(`insert into ${schema}.recipes(family_id,title,description,servings,prep_time_min,cook_time_min,difficulty,image_url,is_custom) values($1,$2,$3,$4,$5,$6,$7,$8,true) returning *`,[b.familyId??null,b.title,b.description??null,b.servings??1,b.prepTimeMin??0,b.cookTimeMin??0,b.difficulty??"MEDIUM",b.imageUrl??null]);for(const [position,i] of (b.ingredients??[]).entries())await c.query(`insert into ${schema}.recipe_ingredients(recipe_id,product_id,display_name,amount,unit,position,allergens) values($1,$2,$3,$4,$5,$6,$7)`,[r.rows[0].id,i.productId??null,i.displayName??i.name,i.amount,i.unit,position,i.allergens??[]]);await c.query("commit");res.status(201).json({data:await recipe(r.rows[0].id)});}catch(e){await c.query("rollback");next(e);}finally{c.release();}});
app.put("/api/v1/recipes/:id", async(req,res,next)=>{try{const b=req.body??{};const q=await pool.query(`update ${schema}.recipes set title=coalesce($2,title),description=coalesce($3,description),servings=coalesce($4,servings),prep_time_min=coalesce($5,prep_time_min),cook_time_min=coalesce($6,cook_time_min),difficulty=coalesce($7,difficulty),image_url=coalesce($8,image_url),updated_at=now() where id=$1 returning id`,[req.params.id,b.title,b.description,b.servings,b.prepTimeMin,b.cookTimeMin,b.difficulty,b.imageUrl]);if(!q.rowCount)return res.status(404).json({error:{code:"NOT_FOUND"}});if(Array.isArray(b.ingredients)){await pool.query(`delete from ${schema}.recipe_ingredients where recipe_id=$1`,[req.params.id]);for(const [position,i] of b.ingredients.entries())await pool.query(`insert into ${schema}.recipe_ingredients(recipe_id,product_id,display_name,amount,unit,position,allergens) values($1,$2,$3,$4,$5,$6,$7)`,[req.params.id,i.productId??null,i.displayName??i.name,i.amount,i.unit,position,i.allergens??[]]);}res.json({data:await recipe(req.params.id)});}catch(e){next(e);}});
app.delete("/api/v1/recipes/:id", async(req,res,next)=>{try{const q=await pool.query(`update ${schema}.recipes set status='ARCHIVED',updated_at=now() where id=$1 returning id`,[req.params.id]);if(!q.rowCount)return res.status(404).json({error:{code:"NOT_FOUND"}});res.status(204).end();}catch(e){next(e);}});
app.post("/api/v1/recipes/:id/photo", async(req,res,next)=>{try{const q=await pool.query(`update ${schema}.recipes set image_url=$2,updated_at=now() where id=$1 returning image_url`,[req.params.id,req.body?.imageUrl]);if(!q.rowCount)return res.status(404).json({error:{code:"NOT_FOUND"}});res.json({data:q.rows[0]});}catch(e){next(e);}});
app.post("/api/v1/recipes/:id/missing-to-shopping", async(req,res,next)=>{try{const r=await recipe(req.params.id);if(!r)return res.status(404).json({error:{code:"NOT_FOUND"}});const fid=String(req.body?.familyId??"");if(!fid)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"familyId is required"}});let active=await core(`/shopping-lists/active?familyId=${encodeURIComponent(fid)}`,req.header("authorization")??undefined);let listId=active?.list?.id;if(!listId){const created=await core("/shopping-lists",req.header("authorization")??undefined,{method:"POST",body:JSON.stringify({familyId:fid,name:"Spesa settimanale"})});listId=created?.list?.id ?? created?.id;}const itemIds=[];const stock=await core(`/inventory/stock-items?familyId=${encodeURIComponent(fid)}`,req.header("authorization")??undefined);const ids=new Set((stock?.items??[]).map((x:any)=>x.productId));for(const i of r.ingredients){if(i.productId&&ids.has(i.productId))continue;const added=await core(`/shopping-lists/${encodeURIComponent(listId)}/items`,req.header("authorization")??undefined,{method:"POST",body:JSON.stringify({familyId:fid,productId:i.productId,displayName:i.displayName,quantity:i.amount,unit:i.unit,sourceType:"RECIPE",sourceRef:r.id})});if(added?.item?.id)itemIds.push(added.item.id);}res.status(201).json({data:{itemIds}});}catch(e){next(e);}});
app.post("/api/v1/recipes/:id/cook", async(req,res,next)=>{try{const r=await recipe(req.params.id);if(!r)return res.status(404).json({error:{code:"NOT_FOUND"}});const fid=String(req.body?.familyId??"");if(!fid)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"familyId is required"}});const servings=Number(req.body?.servings??r.servings);const stock=await core(`/inventory/stock-items?familyId=${encodeURIComponent(fid)}`,req.header("authorization")??undefined);const movements=[];for(const i of r.ingredients){if(!i.productId)continue;const item=(stock?.items??[]).find((x:any)=>x.productId===i.productId);if(!item||item.quantity<=0)continue;const qty=Math.min(Number(i.amount)*servings/r.servings,Number(item.quantity));if(qty<=0)continue;const result=await core(`/inventory/items/${encodeURIComponent(item.id)}/movements`,req.header("authorization")??undefined,{method:"POST",headers:{"if-match":String(item.version)},body:JSON.stringify({familyId:fid,kind:"CONSUMPTION",quantity:qty,unit:item.unit,source:`recipe:${r.id}`,clientOperationId:`recipe:${r.id}:${item.id}:${crypto.randomUUID()}`,occurredAt:new Date().toISOString()})});movements.push(result?.movementId??result?.id);}res.status(202).json({data:{accepted:true,movementIds:movements}});}catch(e){next(e);}});

app.use((err:any,_req:Request,res:any,_next:any)=>{res.status(err?.status??500).json(err?.body??{error:{code:"INTERNAL_ERROR",message:err?.message??"Internal error"}})});
app.listen(port,"0.0.0.0",()=>process.stdout.write(JSON.stringify({service:"service-recipes",port})+"\n"));
