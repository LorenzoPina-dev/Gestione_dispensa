import type { Pool } from "pg";

type PantryItem={productId?:string|null;name:string;quantity?:number;unit?:string;expiresAt?:string|null};
type Suggestion={recipeId:string;score:number;matchedIngredientNames:string[];missingIngredients:Array<{name:string;quantity:number;unit:string}>;recipe:any};

const ALIASES:Record<string,string[]>={pomodoro:["tomato","tomatoes"],cipolla:["onion","onions"],aglio:["garlic"],patata:["potato","potatoes"],carota:["carrot","carrots"],zucchina:["zucchini"],melanzana:["eggplant"],peperone:["bell pepper"],pollo:["chicken"],manzo:["beef"],pancetta:["bacon"],tonno:["tuna"],salmone:["salmon"],uovo:["egg","eggs"],latte:["milk"],burro:["butter"],panna:["cream"],formaggio:["cheese"],mozzarella:["mozzarella"],parmigiano:["parmesan"],farina:["flour"],pane:["bread"],pangrattato:["breadcrumbs"],pasta:["pasta"],spaghetti:["spaghetti"],riso:["rice"],ceci:["chickpea","chickpeas"],fagioli:["bean","beans"],piselli:["pea","peas"],mais:["corn"],olive:["olive"],"olio extravergine":["olive oil"],olio:["oil"],sale:["salt"],acqua:["water"],basilico:["basil"],prezzemolo:["parsley"],rosmarino:["rosemary"],limone:["lemon"],zucchero:["sugar"],cacao:["cocoa"],cioccolato:["chocolate"],miele:["honey"],mandorle:["almond","almonds"],noci:["walnut","walnuts"],nocciole:["hazelnut","hazelnuts"],pistacchio:["pistachio"],mascarpone:["mascarpone"],ricotta:["ricotta"],salsiccia:["sausage"]};

function norm(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();}
function terms(v:string){const n=norm(v),out=new Set([n]);for(const t of n.split(" "))if(t.length>=3)out.add(t);for(const [it,en] of Object.entries(ALIASES)){if(n===it||en.some(x=>n===x)){out.add(it);for(const x of en)out.add(x);}}return out;}
function matches(a:string,b:string){const x=terms(a),y=terms(b);for(const t of x)if(y.has(t))return true;return false;}

async function getInventory(base:string,userId:string,familyId:string,authorization?:string):Promise<PantryItem[]>{
 const u=new URL(base.replace(/\/$/,"")+"/inventory");u.searchParams.set("familyId",familyId);u.searchParams.set("status","current");u.searchParams.set("limit","100");
 const headers:Record<string,string>={"x-user-id":userId,"x-family-id":familyId,accept:"application/json"};if(authorization)headers.authorization=authorization;
 const r=await fetch(u,{headers,signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error("inventory HTTP "+r.status);const b=await r.json() as {items?:PantryItem[]};return b.items??[];
}
async function hydrate(pool:Pool,rows:any[]){if(!rows.length)return[];const ids=rows.map(x=>x.id);const i=await pool.query("select recipe_id,name,display_name,weight from recipe_catalog.recipe_ingredients where recipe_id=any($1::uuid[]) order by recipe_id,position",[ids]);const s=await pool.query("select recipe_id,instruction from recipe_catalog.recipe_steps where recipe_id=any($1::uuid[]) order by recipe_id,position",[ids]);const im=new Map<string,any[]>(),sm=new Map<string,string[]>();for(const x of i.rows){if(!im.has(x.recipe_id))im.set(x.recipe_id,[]);im.get(x.recipe_id)!.push(x);}for(const x of s.rows){if(!sm.has(x.recipe_id))sm.set(x.recipe_id,[]);sm.get(x.recipe_id)!.push(String(x.instruction));}return rows.map(x=>({...x,ingredients:im.get(x.id)??[],steps:sm.get(x.id)??[]}));}

export async function discover(pool:Pool,p:{userId:string;familyId:string;inventoryBaseUrl:string;limit:number;q?:string;authorization?:string}):Promise<Suggestion[]>{
 const stock=await getInventory(p.inventoryBaseUrl,p.userId,p.familyId,p.authorization);
 const stockTerms=[...new Set(stock.flatMap(x=>[...terms(x.name)]))];
 const candidates=p.q
   ? (await pool.query("select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes where title ilike $1 order by similarity(title,$2) desc limit $3",["%"+norm(p.q)+"%",norm(p.q),Math.min(p.limit*20,100)])).rows
   : (await pool.query("select r.id,r.title,r.category,r.difficulty,r.prep_time_minutes,r.source_url,count(distinct i.id) matched from recipe_catalog.recipes r join recipe_catalog.recipe_ingredients i on i.recipe_id=r.id where i.terms && $1::text[] group by r.id order by matched desc,r.difficulty asc nulls last,r.prep_time_minutes asc nulls last limit $2",[stockTerms,Math.min(Math.max(p.limit*20,50),300)])).rows;
 const full=await hydrate(pool,candidates);
 return full.map((r:any)=>{
   const matched=r.ingredients.filter((i:any)=>stock.some(s=>matches(String(i.display_name||i.name),s.name)));
   const missing=r.ingredients.filter((i:any)=>!stock.some(s=>matches(String(i.display_name||i.name),s.name)));
   let expiry=0;
   for(const i of matched){const s=stock.find(x=>matches(String(i.display_name||i.name),x.name));if(s?.expiresAt){const days=(new Date(s.expiresAt).getTime()-Date.now())/86400000;expiry+=Math.max(0,Math.min(1,(7-days)/7));}}
   const coverage=r.ingredients.length?matched.length/r.ingredients.length:0;
   const expiryScore=matched.length?expiry/matched.length:0;
   const shopping=1/(1+missing.length);
   const score=p.q?Number((0.70+0.30*coverage).toFixed(4)):Number((0.72*coverage+0.18*expiryScore+0.10*shopping).toFixed(4));
   return {recipeId:String(r.id),score,matchedIngredientNames:matched.map((x:any)=>String(x.display_name||x.name)),missingIngredients:missing.map((x:any)=>({name:String(x.display_name||x.name),quantity:1,unit:"piece"})),recipe:{recipeId:String(r.id),title:String(r.title),servings:1,timeMinutes:r.prep_time_minutes==null?undefined:Number(r.prep_time_minutes),difficulty:r.difficulty==null?undefined:Number(r.difficulty)<=2?"Facile":Number(r.difficulty)===3?"Medio":"Difficile",quality:"IMPORTED",source:"italian-gastronomic-recipes",sourceUrl:r.source_url??undefined,tags:r.category?[String(r.category)]:[],steps:r.steps,ingredients:r.ingredients.map((x:any)=>({name:String(x.name),displayName:String(x.display_name||x.name),quantity:1,unit:"piece"}))}};
 }).sort((a,b)=>b.score-a.score).slice(0,p.limit);
}

export async function getCatalogRecipe(pool:Pool,id:string){
 const r=await pool.query("select id,title,category,difficulty,prep_time_minutes,source_url from recipe_catalog.recipes where id=$1",[id]);if(!r.rowCount)return null;
 const full=await hydrate(pool,[r.rows[0]]);const x=full[0];
 return {recipeId:String(x.id),title:String(x.title),servings:1,timeMinutes:x.prep_time_minutes==null?undefined:Number(x.prep_time_minutes),difficulty:x.difficulty==null?undefined:Number(x.difficulty)<=2?"Facile":Number(x.difficulty)===3?"Medio":"Difficile",quality:"IMPORTED",source:"italian-gastronomic-recipes",sourceUrl:x.source_url??undefined,tags:x.category?[String(x.category)]:[],steps:x.steps,ingredients:x.ingredients.map((i:any)=>({name:String(i.name),displayName:String(i.display_name||i.name),quantity:1,unit:"piece"}))};
}
