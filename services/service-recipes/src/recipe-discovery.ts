import type { Pool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { ingredientTerms, normalizeFoodText as norm, parseFoodQuantityFromText } from "@gestione-dispensa/food-rules";
import { averageNutriScore, estimateRecipeNutrition, scoreRecipeAgainstPantry, type RecipeIngredientForMatch } from "./pantry-recipe-engine.js";
import { evaluateRecipeSafety, type SafetyProfile } from "./safety-engine.js";
import { aggregateFamilySafetyProfiles, type FamilySafetyProfile } from "./family-safety-profile.js";
import { RECIPE_MATCH_RULES_VERSION, type RecipeMatch } from "./recipe-match.js";
import { normalizeRecipeIngredient } from "./recipe-ingredient-model.js";

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
type PantryItem={productId?:string|null;name?:string;quantity?:number;unit?:string;nutrition?:CatalogProduct["nutrition"];expiresAt?:string|null;addedAt?:string|null;openedAt?:string|null;remainingContentQuantity?:number|null;remainingContentUnit?:"g"|"kg"|"ml"|"l"|"piece"|null;foodSemantics?:FoodSemantics|null};

type CatalogProduct={productId:string;name?:string|null;foodSemantics?:FoodSemantics|null;nutrition?:{kcalPer100g:number|null;proteinGPer100g:number|null;carbsGPer100g:number|null;fatGPer100g:number|null;fiberGPer100g:number|null}|null};
type Suggestion=RecipeMatch & { matchedIngredientNames:string[]; matchedProducts:string[]; safetyWarnings:RecipeMatch["safety"]["warnings"]; recipe:Record<string,unknown> };

const IMAGE_CACHE = new Map<string, string | null>();
const STEPS_CACHE = new Map<string, string[] | null>();
const INGREDIENTS_CACHE = new Map<string, string[] | null>();
const SERVINGS_CACHE = new Map<string, number | null>();

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
    ...(product?.nutrition ? { nutrition: product.nutrition } : {}),
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

export function extractRecipeServings(html:string):number|null{
 const recipeNodes:Record<string,unknown>[]=[];
 const scriptPattern=/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 let match:RegExpExecArray|null;
 while((match=scriptPattern.exec(html))!==null){
  const raw=match[1]?.trim(); if(!raw)continue;
  try{findRecipeNodes(JSON.parse(raw.replace(/^<!--|-->$/g,"").trim()),recipeNodes);}catch{}
 }
 for(const recipe of recipeNodes){
  const value=recipe.recipeYield;
  const candidates=Array.isArray(value)?value.map(String):typeof value==="string"?[value]:[];
  for(const candidate of candidates){
   const normalized=norm(candidate);
   if(!/(serv|porzion|people|persons|persone|slices?|fette|pieces?|pezzi)/i.test(normalized))continue;
   const numberMatch=normalized.match(/(?:^|\\s)(\\d+(?:[.,]\\d+)?)(?:\\s|$)/);
   if(!numberMatch)continue;
   const number=Number(numberMatch[1]!.replace(",",".")); 
   if(Number.isFinite(number)&&number>0&&number<=100)return number;
  }
 }
 return null;
}

function extractRecipeIngredientTexts(html:string):string[]{
 const recipeNodes:Record<string,unknown>[]=[];
 const scriptPattern=/<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/gi;
 let match:RegExpExecArray|null;
 while((match=scriptPattern.exec(html))!==null){
  const raw=match[1]?.trim(); if(!raw)continue;
  try{ findRecipeNodes(JSON.parse(raw.replace(/^<!--|-->$/g,"").trim()),recipeNodes); }catch{ /* ignore malformed JSON-LD blocks */ }
 }
 let best:string[]=[];
 for(const recipe of recipeNodes){
  const values=Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.filter((value):value is string=>typeof value==="string").map(cleanInstruction) : [];
  const unique=[...new Set(values.filter(Boolean))]; if(unique.length>best.length)best=unique;
 }
 return best;
}

async function resolveRecipeIngredientTexts(sourceUrl:string|undefined):Promise<string[]>{
 if(!sourceUrl)return[];
 if(INGREDIENTS_CACHE.has(sourceUrl))return INGREDIENTS_CACHE.get(sourceUrl)??[];
 try{
  const response=await fetch(sourceUrl,{
   headers:{accept:"text/html,application/xhtml+xml","user-agent":"Gestione-Dispensa/2.0 recipe-ingredient-resolver"},
   redirect:"follow",signal:AbortSignal.timeout(8000),
  });
  if(response.ok){
   const html=await response.text();
   SERVINGS_CACHE.set(sourceUrl,extractRecipeServings(html));
   const ingredients=extractRecipeIngredientTexts(html);
   if(ingredients.length){INGREDIENTS_CACHE.set(sourceUrl,ingredients);return ingredients;}
  }
 }catch{ /* external enrichment is optional */ }
 INGREDIENTS_CACHE.set(sourceUrl,null); return[];
}

function containsIngredientPhrase(haystack:string,needle:string):boolean{
 const h=" "+norm(haystack)+" ";
 const n=norm(needle);
 return Boolean(n) && h.includes(" "+n+" ");
}

export function mergeSourceIngredientQuantities(fallback:any[],sourceTexts:string[]):any[]{
 if(!sourceTexts.length)return fallback;
 const normalizedSource=sourceTexts.map((raw,index)=>({raw,index,semantic:normalizeRecipeIngredient(raw)}));
 const used=new Set<number>();
 return fallback.map((item:any,index:number)=>{
  if(item.quantity!=null || item.quantityConfidence>0.5)return item;
  const wanted=normalizeRecipeIngredient(String(item.displayName||item.name));

  let candidate=normalizedSource.find(source =>
    !used.has(source.index) &&
    source.semantic.quantity &&
    wanted.canonicalIngredient &&
    source.semantic.canonicalIngredient===wanted.canonicalIngredient,
  );

  if(!candidate){
   candidate=normalizedSource.find(source =>
     !used.has(source.index) &&
     source.semantic.quantity &&
     containsIngredientPhrase(source.raw,String(item.name)),
   );
  }

  if(!candidate){
   const indexed=normalizedSource[index];
   candidate=indexed?.semantic.quantity ? indexed : undefined;
  }

  if(!candidate?.semantic.quantity)return item;
  used.add(candidate.index);
  const quantity=candidate.semantic.quantity;
  return {
   ...item,
   canonicalIngredient:item.canonicalIngredient??candidate.semantic.canonicalIngredient,
   quantity:Number(quantity.baseValue),
   unit:quantity.baseUnit,
   quantityConfidence:Math.max(Number(item.quantityConfidence??0),candidate.semantic.quantityConfidence),
   sourceQuantityRaw:candidate.raw,
  };
 });
}

async function enrichSuggestionIngredientQuantities(rows:any[],maxSources=64):Promise<any[]>{
 const candidates=rows.slice(0,maxSources).filter(row =>
   typeof row.source_url==="string" &&
   Array.isArray(row.ingredients) &&
   row.ingredients.some((ingredient:any)=>ingredient.quantity_base_value==null && Number(ingredient.quantity_confidence??0)<=0.5),
 );
 let cursor=0;
 const workers=Array.from({length:Math.min(6,candidates.length)},async()=>{
  while(true){
   const index=cursor++;
   if(index>=candidates.length)return;
   const row=candidates[index];
   const sourceUrl=typeof row.source_url==="string"?row.source_url:undefined;
   const sourceTexts=await resolveRecipeIngredientTexts(sourceUrl);
   if(sourceUrl)row.servings=SERVINGS_CACHE.get(sourceUrl)??null;
   row.ingredients=mergeSourceIngredientQuantities(row.ingredients,sourceTexts);
  }
 });
 await Promise.all(workers);
 return rows;
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
   data?:{items?:Array<{userId:string;exists:boolean;allergenTags?:unknown;dietaryRestrictions?:unknown;tracePolicy?:unknown;uncertaintyPolicy?:unknown}>;complete?:boolean};
 };
 const items=identityEnvelope.data?.items??[];
 const profiles=items.map(item=>({
   userId:item.userId,
   exists:Boolean(item.exists),
   allergenTags:Array.isArray(item.allergenTags)?item.allergenTags.map(String):[],
   dietaryRestrictions:Array.isArray(item.dietaryRestrictions)?item.dietaryRestrictions.map(String):[],
   tracePolicy:item.tracePolicy==="EXCLUDE"?"EXCLUDE" as const:"WARN" as const,
   uncertaintyPolicy:item.uncertaintyPolicy==="WARN"?"WARN" as const:"EXCLUDE" as const,
 }));
 const aggregate=aggregateFamilySafetyProfiles(memberUserIds,profiles);
 if(!aggregate.complete){
   throw new Error("family dietary profile incomplete for "+aggregate.missingPreferenceUserIds.join(","));
 }
 return aggregate;
}

function toRecipeMatchIngredients(rows: readonly any[]): RecipeIngredientForMatch[] {
 return rows.map((row:any)=>{
  const quantityUnit=row.quantity_unit??row.unit??null;
  const quantityBaseUnit=row.quantity_base_unit??row.unit??null;
  const quantityDimension=row.quantity_dimension==="mass" || row.quantity_dimension==="volume" || row.quantity_dimension==="count"
    ? row.quantity_dimension
    : quantityBaseUnit==="g" || quantityBaseUnit==="kg" ? "mass"
      : quantityBaseUnit==="ml" || quantityBaseUnit==="l" ? "volume"
        : quantityBaseUnit==="piece" ? "count" : null;
  return {
   id: typeof row.id==="string" ? row.id : undefined,
   productId: typeof row.product_id==="string" ? row.product_id : null,
   name: String(row.name ?? ""),
   displayName: String(row.display_name ?? row.displayName ?? row.name ?? ""),
   canonicalIngredient: typeof (row.canonical_ingredient??row.canonicalIngredient)==="string" ? row.canonical_ingredient??row.canonicalIngredient : null,
   semanticConfidence: Number(row.semantic_confidence ?? row.semanticConfidence ?? 0),
   ingredientTerms: Array.isArray(row.ingredient_terms ?? row.ingredientTerms) ? (row.ingredient_terms ?? row.ingredientTerms).map(String) : [],
   culinaryWeight: row.culinary_weight==="STAPLE" || row.culinary_weight==="SECONDARY" || row.culinary_weight==="CORE" ? row.culinary_weight : "CORE",
   quantityValue: (row.quantity_value??row.quantity)==null ? null : Number(row.quantity_value??row.quantity),
   quantityUnit: quantityUnit==null ? null : String(quantityUnit),
   quantityDimension,
   quantityBaseValue: (row.quantity_base_value??row.quantity)==null ? null : Number(row.quantity_base_value??row.quantity),
   quantityBaseUnit: quantityBaseUnit==="g" || quantityBaseUnit==="ml" || quantityBaseUnit==="piece" ? quantityBaseUnit : null,
   quantityConfidence: Number(row.quantity_confidence ?? row.quantityConfidence ?? 0),
  };
 });
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
  const queryText=norm(p.q);
  const queryTerms=[...new Set(ingredientTerms(p.q).map(norm).filter(Boolean))];
  const limit=Math.min(Math.max(p.limit,1),100);
  fullCandidateRows=(await pool.query(
   queryTerms.length
     ? "select r.id,r.title,r.category,r.difficulty,r.prep_time_minutes,r.source_url,case when r.title ilike $1 then 2 else 0 end + case when r.ingredient_terms && $2::text[] then 1 else 0 end as match_boost from recipe_catalog.recipes r where r.title ilike $1 or r.ingredient_terms && $2::text[] order by match_boost desc,similarity(r.title,$3) desc,r.title asc limit $4"
     : "select r.id,r.title,r.category,r.difficulty,r.prep_time_minutes,r.source_url,case when r.title ilike $1 then 2 else 0 end as match_boost from recipe_catalog.recipes r where r.title ilike $1 order by match_boost desc,similarity(r.title,$2) desc,r.title asc limit $3",
   queryTerms.length
     ? ["%"+queryText+"%",queryTerms,queryText,limit]
     : ["%"+queryText+"%",queryText,limit],
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
 const enrichedFull=await enrichSuggestionIngredientQuantities(full);
 const pantry=stock
   .filter((item): item is PantryItem & {productId:string;quantity:number;unit:string} =>
     typeof item.productId==="string" && Number.isFinite(item.quantity) && Number(item.quantity)>0 && typeof item.unit==="string" && item.unit.trim().length>0
   )
   .map(item=>({
     productId:String(item.productId),
     name:pantryName(item),
     quantity:Number(item.quantity),
     unit:String(item.unit),
     nutrition:item.nutrition??null,
     expiresAt:item.expiresAt??null,
     addedAt:item.addedAt??null,
     openedAt:item.openedAt??null,
     remainingContentQuantity:item.remainingContentQuantity??null,
     remainingContentUnit:item.remainingContentUnit??null,
     foodSemantics:item.foodSemantics??null,
   }));
 const scored:Suggestion[]=enrichedFull.map((r:any)=>{
   const coverage=scoreRecipeAgainstPantry(toRecipeMatchIngredients(r.ingredients),pantry);
   const matched=coverage.matchedIngredients.filter(item=>item.ratio>0);
   const usedProductIds=new Set(coverage.matchedProductIds);
   const safety=evaluateRecipeSafety(
     r.ingredients.map((x:any)=>({name:String(x.name),canonicalIngredient:x.canonical_ingredient??null,ingredientTerms:Array.isArray(x.ingredient_terms)?x.ingredient_terms.map(String):[],matchedProductIds:coverage.matchedIngredients.find((m:any)=>m.recipeIngredient===String(x.display_name||x.name))?.productIds??[]})),
     pantry.filter(item=>usedProductIds.has(item.productId)).map(item=>({productId:item.productId,name:item.name,foodSemantics:item.foodSemantics??null})),
     safetyProfile,
   );
   const missing=coverage.missingIngredients;
   const nutri=averageNutriScore(pantry,coverage.matchedProductIds);
   const servings=typeof r.servings==="number"&&r.servings>0?Number(r.servings):null;
   const nutrition=estimateRecipeNutrition(coverage.matchedIngredients,pantry,servings);
   const recipe={
     recipeId:String(r.id),
     title:String(r.title),
     servings:r.servings==null?null:Number(r.servings),
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
   const usedByProduct=new Map<string,{baseUnit:"g"|"ml"|"piece";usedBaseQuantity:number;usedFor:Set<string>}>();
   for(const match of coverage.matchedIngredients){
     for(const allocation of match.allocations){
       const current=usedByProduct.get(allocation.productId)??{
         baseUnit:allocation.baseUnit,
         usedBaseQuantity:0,
         usedFor:new Set<string>(),
       };
       current.usedBaseQuantity+=allocation.usedBaseValue;
       current.usedFor.add(match.recipeIngredient);
       usedByProduct.set(allocation.productId,current);
     }
     if(match.allocations.length===0){
       for(const productId of match.productIds){
         const current=usedByProduct.get(productId)??{
           baseUnit:"piece" as const,
           usedBaseQuantity:0,
           usedFor:new Set<string>(),
         };
         current.usedFor.add(match.recipeIngredient);
         usedByProduct.set(productId,current);
       }
     }
   }
   const pantryProductsUsed=pantry
     .filter(item=>usedByProduct.has(item.productId))
     .map(item=>{
       const used=usedByProduct.get(item.productId)!;
       return {
         productId:item.productId,
         name:item.name,
         quantity:item.quantity,
         unit:item.unit,
         expiresAt:item.expiresAt??null,
         usedBaseQuantity:Number(used.usedBaseQuantity.toFixed(6)),
         usedBaseUnit:used.baseUnit,
         quantityBase:item.foodSemantics?.quantityBase??null,
         usedFor:[...used.usedFor],
       };
     });
   return {
     recipeId:String(r.id),
     title:String(r.title),
     rulesVersion:RECIPE_MATCH_RULES_VERSION,
     score:coverage.score,
     readiness:safety.safe?coverage.readiness:"DISCARD",
     timeMinutes:r.prep_time_minutes==null?null:Number(r.prep_time_minutes),
     difficulty:r.difficulty==null?null:Number(r.difficulty)<=2?"Facile":Number(r.difficulty)===3?"Medio":"Difficile",
     servings:r.servings==null?null:Number(r.servings),
     pantryProductsUsed,
     matchedIngredients:coverage.matchedIngredients,
     missingIngredients:coverage.missingIngredients,
     substitutions:coverage.substitutions,
     instructions:Array.isArray(r.steps)?r.steps.map(String):[],
     nutrition:{status:nutrition.status,total:nutrition.total,perServing:nutrition.perServing,coverage:nutrition.coverage,nutriScoreAverage:nutri.average,nutriScoreCoverage:nutri.coverage,nutriScoreScope:nutri.average===null?"UNAVAILABLE":"MATCHED_PANTRY_PRODUCTS",note:nutrition.note},
     safety:{safe:safety.safe,warnings:safety.warnings},
     availability:{excludedExpiredProductIds:coverage.excludedExpiredProductIds},
     coverage:{
       matched:matched.length,
       total:coverage.matchedIngredients.length,
       weightedScore:coverage.score,
       missingCoreCount:coverage.missingCoreCount,
       missingCoreWeight:coverage.missingCoreWeight,
     },
     explanation:{ruleVersion:RECIPE_MATCH_RULES_VERSION,quantityAware:coverage.matchedIngredients.some(item=>item.requiredQuantity!==null),familySafetyApplied:true},
     matchedIngredientNames:matched.map(item=>item.recipeIngredient),
     matchedProducts:coverage.matchedProductIds,
     safetyWarnings:safety.warnings,
     recipe,
   };
 });
 const result=scored.filter(item=>item.safety.safe).sort((a,b)=>{
   const scoreDiff=b.score-a.score;
   if(scoreDiff!==0)return scoreDiff;
   const coreDiff=a.coverage.missingCoreCount-b.coverage.missingCoreCount;
   if(coreDiff!==0)return coreDiff;
   const aCoverage=a.nutrition.coverage;
   const bCoverage=b.nutrition.coverage;
   if(aCoverage!==bCoverage)return bCoverage-aCoverage;
   const aNutri=a.nutrition.nutriScoreAverage;
   const bNutri=b.nutrition.nutriScoreAverage;
   if(aNutri!==null&&bNutri!==null&&aNutri!==bNutri)return aNutri-bNutri;
   if(aNutri===null&&bNutri!==null)return 1;
   if(aNutri!==null&&bNutri===null)return -1;
   return Number(a.timeMinutes??999)-Number(b.timeMinutes??999);
 }).slice(0,p.limit);
 await resolveRecipeImages(result);
 return result;
}

export async function getCatalogRecipe(pool:Pool,id:string){
 const r=await pool.query("select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes where id=$1",[id]);if(!r.rowCount)return null;
 const full=await hydrate(pool,[r.rows[0]]);const x=full[0];
 const sourceUrl=typeof x.source_url==="string"?x.source_url:undefined;
 const [steps,sourceIngredientTexts]=await Promise.all([
  resolveRecipeSteps(sourceUrl,x.steps),
  resolveRecipeIngredientTexts(sourceUrl),
 ]);
 const sourceServings=sourceUrl?SERVINGS_CACHE.get(sourceUrl)??null:null;
 const enrichedIngredients=mergeSourceIngredientQuantities(x.ingredients.map((i:any)=>({
  name:String(i.name),
  displayName:String(i.display_name||i.name),
  canonicalIngredient:i.canonical_ingredient??null,
  culinaryWeight:String(i.culinary_weight??"CORE"),
  quantity:i.quantity_base_value==null?null:Number(i.quantity_base_value),
  unit:i.quantity_base_unit??null,
  quantityConfidence:Number(i.quantity_confidence??0),
  sourceWeight:i.weight==null?null:Number(i.weight),
  sourceQuantityRaw:i.source_quantity_raw??null,
 })),sourceIngredientTexts);
 const recipe={recipeId:String(x.id),title:String(x.title),servings:sourceServings,timeMinutes:x.prep_time_minutes==null?null:Number(x.prep_time_minutes),difficulty:x.difficulty==null?null:Number(x.difficulty)<=2?"Facile":Number(x.difficulty)===3?"Medio":"Difficile",quality:"IMPORTED",source:"italian-gastronomic-recipes",sourceUrl,tags:x.category?[String(x.category)]:[],steps,ingredients:enrichedIngredients};
 const image=await resolveRecipeImage(typeof recipe.sourceUrl==="string"?recipe.sourceUrl:undefined);
 return image?{...recipe,image}:recipe;
}
