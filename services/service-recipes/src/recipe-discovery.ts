import type { Pool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { ingredientTerms, normalizeFoodText as norm } from "@gestione-dispensa/food-rules";
import { scoreRecipeAgainstPantry } from "./pantry-recipe-engine.js";
import { evaluateRecipeSafety, type SafetyProfile } from "./safety-engine.js";
import { aggregateFamilySafetyProfiles, type FamilySafetyProfile } from "./family-safety-profile.js";
import type { RecipeMatch } from "./recipe-match.js";

type FoodSemantics = {
 canonicalIngredient?: string | null;
 ingredientTerms?: string[];
 taxonomyTags?: string[];
 allergenTags?: string[];
 traceTags?: string[];
 labelTags?: string[];
 dietaryTags?: string[];
 culinaryWeight?: "STAPLE" | "SECONDARY" | "CORE";
 quantity?: { value: number; unit: string } | null;
 quantityBase?: { value: number; unit: "g" | "ml" | "piece" } | null;
 quantityConfidence?: number;
 semanticConfidence?: number;
 components?: Array<{raw?:string;canonicalIngredient:string|null;ingredientTerms:string[];percentage?:number|null;confidence:number}>;
 compositionConfidence?: number;
};
type PantryItem={productId?:string|null;name?:string;quantity?:number;unit?:string;expiresAt?:string|null;foodSemantics?:FoodSemantics|null};

type CatalogProduct={productId:string;name?:string|null;foodSemantics?:FoodSemantics|null};
type Suggestion=RecipeMatch & { matchedIngredientNames:string[]; matchedProducts:string[]; safetyWarnings:RecipeMatch["safety"]["warnings"]; recipe:Record<string,unknown> };

const IMAGE_CACHE = new Map<string, string | null>();
const STEPS_CACHE = new Map<string, string[] | null>();

async function getInventory(base:string,userId:string,familyId:string,authorization?:string):Promise<PantryItem[]>{
 const u=new URL(base.replace(/\/$/,"")+"/inventory");u.searchParams.set("familyId",familyId);u.searchParams.set("status","current");u.searchParams.set("limit","100");
 const headers:Record<string,string>={"x-user-id":userId,"x-family-id":familyId,accept:"application/json"};if(authorization)headers.authorization=authorization;
 const r=await fetch(u,{headers,signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error("inventory HTTP "+r.status);const b=await r.json() as {items?:PantryItem[]};return b.items??[];
}

async function enrichInventoryNames(stock:PantryItem[],catalogBase:string,authorization?:string):Promise<PantryItem[]>{
 const ids=[...new Set(stock.map(item=>typeof item.productId==="string"?item.productId:"").filter(Boolean))];
 if(ids.length===0)return stock;
 const headers:Record<string,string>={"content-type":"application/json",accept:"application/json"};
 if(authorization)headers.authorization=authorization;
 const response=await fetch(catalogBase.replace(/\/$/,"")+"/catalog/products/batch",{
   method:"POST",
   headers,
   body:JSON.stringify({ids}),
   signal:AbortSignal.timeout(2500),
 });
 if(!response.ok)throw new Error("catalog HTTP "+response.status);
 const envelope=await response.json() as {data?:{items?:CatalogProduct[]};items?:CatalogProduct[]};
 const body=envelope.data??envelope;
 const products = new Map<string, CatalogProduct>();
 for (const item of body.items ?? []) {
  if (item.productId) products.set(item.productId, item);
 }
 return stock.map((item): PantryItem => {
  const product = products.get(String(item.productId ?? ""));
  const resolvedName = typeof item.name === "string" && item.name.trim()
    ? item.name.trim()
    : (typeof product?.name === "string" ? product.name.trim() : "");
  return {
    ...item,
    ...(resolvedName ? { name: resolvedName } : {}),
    ...(product?.foodSemantics ? { foodSemantics: product.foodSemantics } : {}),
  };
 });
}

function pantryName(item:PantryItem):string{
 return typeof item.name==="string"?item.name.trim():"";
}

async function resolveRecipeImage(sourceUrl:string|undefined):Promise<string|undefined>{
 if(!sourceUrl)return undefined;
 if(IMAGE_CACHE.has(sourceUrl)){
  const cached=IMAGE_CACHE.get(sourceUrl);
  return cached??undefined;
 }
 try{
  const response=await fetch(sourceUrl,{
   headers:{
    accept:"text/html,application/xhtml+xml",
    "user-agent":"Gestione-Dispensa/2.0 recipe-image-resolver",
   },
   redirect:"follow",
   signal:AbortSignal.timeout(5000),
  });
  if(!response.ok){
   IMAGE_CACHE.set(sourceUrl,null);
   return undefined;
  }
  const html=await response.text();
  const patterns=[
   /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
   /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
   /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
   /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
  ];
  for(const pattern of patterns){
   const match=html.match(pattern);
   const raw=match?.[1]?.trim();
   if(!raw)continue;
   const imageUrl=new URL(raw,sourceUrl).toString();
   IMAGE_CACHE.set(sourceUrl,imageUrl);
   return imageUrl;
  }
 }catch{
  // An unavailable source image must not make recipe suggestions fail.
 }
 IMAGE_CACHE.set(sourceUrl,null);
 return undefined;
}

function cleanInstruction(value:string):string{
 let text=value
  .replace(/<[^>]*>/g," ")
  .replace(/&nbsp;/gi," ")
  .replace(/&amp;/gi,"&")
  .replace(/&quot;/gi,"\"")
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/&lt;/gi,"<")
  .replace(/&gt;/gi,">")
  .replace(/\s+/g," ")
  .trim();
 text=text.replace(/^\s*\d+\s*[.)-:]\s*/,"");
 return text;
}

function recipeType(value:unknown):boolean{
 if(!value || typeof value!=="object") return false;
 const type=(value as {["@type"]?:unknown})["@type"];
 return Array.isArray(type) ? type.some(x=>String(x).toLowerCase()==="recipe") : String(type??"").toLowerCase()==="recipe";
}

function collectInstructionTexts(value:unknown,out:string[]):void{
 if(typeof value==="string"){
  const cleaned=cleanInstruction(value);
  if(cleaned) out.push(cleaned);
  return;
 }
 if(Array.isArray(value)){
  for(const item of value) collectInstructionTexts(item,out);
  return;
 }
 if(!value || typeof value!=="object") return;
 const object=value as Record<string,unknown>;
 if (Array.isArray(object.itemListElement) && object.itemListElement.length > 0) {
  collectInstructionTexts(object.itemListElement, out);
  return;
 }
 if(typeof object.text==="string"){
  const cleaned=cleanInstruction(object.text);
  if(cleaned) out.push(cleaned);
  return;
 }
}

function findRecipeNodes(value:unknown,out:Record<string,unknown>[]):void{
 if(Array.isArray(value)){
  for(const item of value) findRecipeNodes(item,out);
  return;
 }
 if(!value || typeof value!=="object") return;
 const object=value as Record<string,unknown>;
 if(recipeType(object)) out.push(object);
 for(const child of Object.values(object)){
  if(child && typeof child==="object") findRecipeNodes(child,out);
 }
}

function extractRecipeInstructions(html:string):string[]{
 const recipeNodes:Record<string,unknown>[]=[];
 const scriptPattern=/<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/gi;
 let match:RegExpExecArray|null;
 while((match=scriptPattern.exec(html))!==null){
  const raw=match[1]?.trim();
  if(!raw) continue;
  try{
   findRecipeNodes(JSON.parse(raw.replace(/^<!--|-->$/g,"").trim()),recipeNodes);
  }catch{
   // Some pages include auxiliary JSON-LD that is not strict JSON. Ignore it.
  }
 }
 let best:string[]=[];
 for(const recipe of recipeNodes){
  const values:string[]=[];
  collectInstructionTexts(recipe.recipeInstructions,values);
  const unique=[...new Set(values)];
  if(unique.length>best.length) best=unique;
 }
 return best;
}

async function resolveRecipeSteps(sourceUrl:string|undefined,fallback:string[]):Promise<string[]>{
 if(!sourceUrl) return fallback;
 if(STEPS_CACHE.has(sourceUrl)) return STEPS_CACHE.get(sourceUrl)??fallback;
 try{
  const response=await fetch(sourceUrl,{
   headers:{
    accept:"text/html,application/xhtml+xml",
    "user-agent":"Gestione-Dispensa/2.0 recipe-step-resolver",
   },
   redirect:"follow",
   signal:AbortSignal.timeout(8000),
  });
  if(response.ok){
   const html=await response.text();
   const steps=extractRecipeInstructions(html);
   if(steps.length>0){
    STEPS_CACHE.set(sourceUrl,steps);
    return steps;
   }
  }
 }catch{
  // The source page is enrichment only; keep the dataset fallback.
 }
 STEPS_CACHE.set(sourceUrl,null);
 return fallback;
}

async function resolveRecipeImages(items:Suggestion[]):Promise<void>{
 let cursor=0;
 const workers=Array.from({length:Math.min(5,items.length)},async()=>{
  while(true){
   const index=cursor++;
   if(index>=items.length)return;
   const item=items[index];
   const image=await resolveRecipeImage(typeof item.recipe.sourceUrl==="string"?item.recipe.sourceUrl:undefined);
   if(image)item.recipe.image=image;
  }
 });
 await Promise.all(workers);
}
async function hydrate(pool:Pool,rows:any[]){
 if(!rows.length)return[];
 const ids=rows.map(x=>x.id);
 const i=await pool.query(
  "select recipe_id,name,display_name,weight,canonical_ingredient,semantic_confidence,semantic_status,ingredient_terms,quantity_value,quantity_unit,quantity_dimension,quantity_base_value,quantity_base_unit,quantity_confidence,culinary_weight,prep_state from recipe_catalog.recipe_ingredients where recipe_id=any($1::uuid[]) order by recipe_id,position",
  [ids],
 );
 const s=await pool.query("select recipe_id,instruction from recipe_catalog.recipe_steps where recipe_id=any($1::uuid[]) order by recipe_id,position",[ids]);
 const im=new Map<string,any[]>(),sm=new Map<string,string[]>();
 for(const x of i.rows){if(!im.has(x.recipe_id))im.set(x.recipe_id,[]);im.get(x.recipe_id)!.push(x);}
 for(const x of s.rows){if(!sm.has(x.recipe_id))sm.set(x.recipe_id,[]);sm.get(x.recipe_id)!.push(String(x.instruction));}
 return rows.map(x=>({...x,ingredients:im.get(x.id)??[],steps:sm.get(x.id)??[]}));
}

async function loadFamilySafetyProfile(
 familyBase:string,
 identityBase:string,
 identityToken:string,
 userId:string,
 familyId:string,
 authorization?:string,
):Promise<FamilySafetyProfile>{
 const familyHeaders:Record<string,string>={accept:"application/json","x-user-id":userId,"x-family-id":familyId};
 if(authorization)familyHeaders.authorization=authorization;
 const familyResponse=await fetch(
   familyBase.replace(/\/$/,"")+"/families/"+encodeURIComponent(familyId)+"/members",
   {headers:familyHeaders,signal:AbortSignal.timeout(2500)},
 );
 if(!familyResponse.ok)throw new Error("family members HTTP "+familyResponse.status);
 const familyEnvelope=await familyResponse.json() as {items?:Array<{userId?:unknown}>};
 const memberUserIds=[...new Set((familyEnvelope.items??[]).map(item=>typeof item.userId==="string"?item.userId:"").filter(Boolean))];
 if(!memberUserIds.includes(userId))memberUserIds.push(userId);
 if(memberUserIds.length===0)throw new Error("family members response is empty");

 const headers:Record<string,string>={accept:"application/json","x-internal-service-token":identityToken};
 const identityResponse=await fetch(
   identityBase.replace(/\/$/,"")+"/internal/dietary-preferences?userIds="+encodeURIComponent(memberUserIds.join(",")),
   {headers,signal:AbortSignal.timeout(2500)},
 );
 if(!identityResponse.ok)throw new Error("identity family preferences HTTP "+identityResponse.status);
 const identityEnvelope=await identityResponse.json() as {
   data?:{items?:Array<{userId:string;exists:boolean;allergenTags?:unknown;dietaryRestrictions?:unknown;tracePolicy?:unknown}>;complete?:boolean};
 };
 const items=identityEnvelope.data?.items??[];
 const profiles=items.map(item=>({
   userId:item.userId,
   exists:Boolean(item.exists),
   allergenTags:Array.isArray(item.allergenTags)?item.allergenTags.map(String):[],
   dietaryRestrictions:Array.isArray(item.dietaryRestrictions)?item.dietaryRestrictions.map(String):[],
   tracePolicy:item.tracePolicy==="EXCLUDE"?"EXCLUDE" as const:"WARN" as const,
 }));
 const aggregate=aggregateFamilySafetyProfiles(memberUserIds,profiles);
 if(!aggregate.complete){
   throw new Error("family dietary profile incomplete for "+aggregate.missingPreferenceUserIds.join(","));
 }
 return aggregate;
}

export async function discover(pool:Pool,p:{userId:string;familyId:string;inventoryBaseUrl:string;catalogBaseUrl?:string;limit:number;q?:string;authorization?:string;identityBaseUrl?:string;identityInternalToken:string;familyBaseUrl:string}):Promise<Suggestion[]>{
 const rawStock=await getInventory(p.inventoryBaseUrl,p.userId,p.familyId,p.authorization);
 const stock=p.catalogBaseUrl?await enrichInventoryNames(rawStock,p.catalogBaseUrl,p.authorization):rawStock;
 const safetyProfile=await loadFamilySafetyProfile(p.familyBaseUrl,p.identityBaseUrl??"http://service-identity:3310/api/v1",p.identityInternalToken,p.userId,p.familyId,p.authorization);
 const stockTerms=[...new Set(stock.flatMap(x=>{
   const semanticTerms=x.foodSemantics?.ingredientTerms ?? [];
   const taxonomy=x.foodSemantics?.taxonomyTags ?? [];
   const name=pantryName(x);
   return [
     ...semanticTerms.map(value=>norm(value)),
     ...taxonomy.map(value=>norm(value)),
     ...(name?ingredientTerms(name):[]),
   ].filter(Boolean);
 }))];
 let fullCandidateRows:any[];
 if(p.q){
  fullCandidateRows=(await pool.query(
   "select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes where title ilike $1 order by similarity(title,$2) desc limit $3",
   ["%"+norm(p.q)+"%",norm(p.q),Math.min(Math.max(p.limit,1),100)],
  )).rows;
 }else{
  const candidateLimit=Math.min(Math.max(p.limit*20,50),300);
  const matchedRows=(await pool.query(
   "select r.id,r.title,r.category,r.difficulty,r.prep_time_minutes,r.source_url,count(distinct i.id) matched from recipe_catalog.recipes r join recipe_catalog.recipe_ingredients i on i.recipe_id=r.id where i.ingredient_terms && $1::text[] group by r.id order by matched desc,r.difficulty asc nulls last,r.prep_time_minutes asc nulls last limit $2",
   [stockTerms,candidateLimit],
  )).rows;
  const remaining=candidateLimit-matchedRows.length;
  if(remaining<=0){
   fullCandidateRows=matchedRows;
  }else{
   const excluded=matchedRows.map((row:any)=>String(row.id));
   const fallbackQuery=excluded.length
     ? "select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes where not (id::text = any($1::text[])) order by difficulty asc nulls last,prep_time_minutes asc nulls last,title asc limit $2"
     : "select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes order by difficulty asc nulls last,prep_time_minutes asc nulls last,title asc limit $1";
   const fallbackArgs:unknown[] = excluded.length ? [excluded,remaining] : [remaining];
   const fallbackRows=(await pool.query(fallbackQuery,fallbackArgs)).rows;
   fullCandidateRows=[...matchedRows,...fallbackRows];
  }
 }
 const full=await hydrate(pool,fullCandidateRows);
 const pantry=stock
   .filter((item): item is PantryItem & {productId:string;quantity:number;unit:string} =>
     typeof item.productId==="string" && Number.isFinite(item.quantity) && Number(item.quantity)>0 && typeof item.unit==="string" && item.unit.trim().length>0
   )
   .map(item=>({
     productId:String(item.productId),
     name:pantryName(item),
     quantity:Number(item.quantity),
     unit:String(item.unit),
     expiresAt:item.expiresAt??null,
     foodSemantics:item.foodSemantics??null,
   }));
 const scored:Suggestion[]=full.map((r:any)=>{
   const coverage=scoreRecipeAgainstPantry(r.ingredients,pantry);
   const matched=coverage.matchedIngredients.filter(item=>item.ratio>0);
   const usedProductIds=new Set(coverage.matchedProductIds);
   const safety=evaluateRecipeSafety(
     r.ingredients.map((x:any)=>({name:String(x.name),canonicalIngredient:x.canonical_ingredient??null,ingredientTerms:Array.isArray(x.ingredient_terms)?x.ingredient_terms.map(String):[]})),
     pantry.filter(item=>usedProductIds.has(item.productId)).map(item=>({productId:item.productId,name:item.name,foodSemantics:item.foodSemantics??null})),
     safetyProfile,
   );
   const missing=coverage.missingIngredients;
   const recipe={
     recipeId:String(r.id),
     title:String(r.title),
     servings:null,
     timeMinutes:r.prep_time_minutes==null?null:Number(r.prep_time_minutes),
     difficulty:r.difficulty==null?null:Number(r.difficulty)<=2?"Facile":Number(r.difficulty)===3?"Medio":"Difficile",
     quality:"IMPORTED",
     source:"italian-gastronomic-recipes",
     sourceUrl:r.source_url??undefined,
     tags:r.category?[String(r.category)]:[],
     steps:r.steps,
     ingredients:r.ingredients.map((x:any)=>({
       name:String(x.name),
       displayName:String(x.display_name||x.name),
       canonicalIngredient:x.canonical_ingredient??null,
       culinaryWeight:String(x.culinary_weight??"CORE"),
       quantity:x.quantity_base_value==null?null:Number(x.quantity_base_value),
       unit:x.quantity_base_unit??null,
       quantityConfidence:Number(x.quantity_confidence??0),
       sourceWeight:x.weight==null?null:Number(x.weight),
     })),
   };
   const pantryProductsUsed=pantry
     .filter(item=>coverage.matchedProductIds.includes(item.productId))
     .map(item=>({
       productId:item.productId,
       name:item.name,
       quantity:item.quantity,
       unit:item.unit,
       expiresAt:item.expiresAt??null,
     }));
   return {
     recipeId:String(r.id),
     title:String(r.title),
     score:coverage.score,
     readiness:safety.safe?coverage.readiness:"DISCARD",
     timeMinutes:r.prep_time_minutes==null?null:Number(r.prep_time_minutes),
     difficulty:r.difficulty==null?null:Number(r.difficulty)<=2?"Facile":Number(r.difficulty)===3?"Medio":"Difficile",
     servings:null,
     pantryProductsUsed,
     matchedIngredients:coverage.matchedIngredients,
     missingIngredients:coverage.missingIngredients,
     substitutions:coverage.substitutions,
     instructions:Array.isArray(r.steps)?r.steps.map(String):[],
     nutrition:{status:"UNAVAILABLE",perServing:null,note:"Recipe dataset does not provide reliable per-ingredient nutritional quantities."},
     safety:{safe:safety.safe,warnings:safety.warnings},
     coverage:{
       matched:matched.length,
       total:coverage.matchedIngredients.length,
       weightedScore:coverage.score,
       missingCoreCount:coverage.missingCoreCount,
       missingCoreWeight:coverage.missingCoreWeight,
     },
     explanation:{ruleVersion:"pantry-recipe-engine-v2",quantityAware:coverage.matchedIngredients.some(item=>item.requiredQuantity!==null),familySafetyApplied:true},
     matchedIngredientNames:matched.map(item=>item.recipeIngredient),
     matchedProducts:coverage.matchedProductIds,
     safetyWarnings:safety.warnings,
     recipe,
   };
 });
 const result=scored.filter(item=>item.safety.safe).sort((a,b)=>b.score-a.score || a.coverage.missingCoreCount-b.coverage.missingCoreCount || (Number(a.timeMinutes??999)-Number(b.timeMinutes??999))).slice(0,p.limit);
 await resolveRecipeImages(result);
 return result;
}

export async function getCatalogRecipe(pool:Pool,id:string){
 const r=await pool.query("select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes where id=$1",[id]);if(!r.rowCount)return null;
 const full=await hydrate(pool,[r.rows[0]]);const x=full[0];
 const sourceUrl=typeof x.source_url==="string"?x.source_url:undefined;
 const steps=await resolveRecipeSteps(sourceUrl,x.steps);
 const recipe={recipeId:String(x.id),title:String(x.title),servings:null,timeMinutes:x.prep_time_minutes==null?null:Number(x.prep_time_minutes),difficulty:x.difficulty==null?null:Number(x.difficulty)<=2?"Facile":Number(x.difficulty)===3?"Medio":"Difficile",quality:"IMPORTED",source:"italian-gastronomic-recipes",sourceUrl,tags:x.category?[String(x.category)]:[],steps,ingredients:x.ingredients.map((i:any)=>({name:String(i.name),displayName:String(i.display_name||i.name),canonicalIngredient:i.canonical_ingredient??null,culinaryWeight:String(i.culinary_weight??"CORE"),quantity:i.quantity_base_value==null?null:Number(i.quantity_base_value),unit:i.quantity_base_unit??null,quantityConfidence:Number(i.quantity_confidence??0),sourceWeight:i.weight==null?null:Number(i.weight)}))};
 const image=await resolveRecipeImage(typeof recipe.sourceUrl==="string"?recipe.sourceUrl:undefined);
 return image?{...recipe,image}:recipe;
}
