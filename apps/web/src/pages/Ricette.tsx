import { useEffect, useMemo, useState } from "react";
import type { ShoppingList, Recipe, RecipeMatch, StockItem } from "../types";
import type { RecipeMatchDto } from "../api/types";
import RecipeDetail, { type RecipeMatchWithUsage } from "../components/recipes/RecipeDetail";
import * as api from "../api/endpoints";
import { colors } from "../tokens";
import Toggle from "../components/ui/Toggle";
import EmptyState from "../components/ui/EmptyState";
import RecipeShoppingSelector from "../components/recipes/RecipeShoppingSelector";
interface Props { stock: StockItem[]; setStock: React.Dispatch<React.SetStateAction<StockItem[]>>; setList: React.Dispatch<React.SetStateAction<ShoppingList>>; onShoppingChanged?: () => Promise<void>; onNavigateToShopping?: () => void; familyId?: string | null; suggestedRecipes?: RecipeMatchDto[]; }
function mapRecipeDto(r:RecipeMatchDto["recipe"]):Recipe{return{id:r.id??r.recipeId??"",title:r.title,source:r.source??"",quality:r.quality??"UNKNOWN",servings:r.servings,time:r.timeMinutes??0,difficulty:r.difficulty??"Facile",ingredients:r.ingredients.map(i=>({name:i.displayName??i.name??i.recipeIngredient??"Ingrediente",stockItemId:i.productId??undefined,amount:i.amount??i.quantity??0,unit:i.unit,allergens:i.allergens??[]})),steps:r.steps,image:r.image??"",tags:r.tags??[],caloriesPerServing:r.caloriesPerServing??0};}
function mapMatch(m:RecipeMatchDto):RecipeMatchWithUsage{return{recipe:mapRecipeDto(m.recipe),score:m.score,matchedIngredients:(m.matchedIngredientNames??[]).map(name=>name),missingIngredients:m.missingIngredients.map(i=>i.displayName??i.name??i.recipeIngredient??i.canonicalIngredient??"Ingrediente").filter((name):name is string=>Boolean(name.trim())),pantryProductsUsed:m.pantryProductsUsed};}
export default function Ricette({stock,setStock,onShoppingChanged,onNavigateToShopping,familyId,suggestedRecipes=[]}:Props){
const[onlyFeasible,setOnlyFeasible]=useState(false),[detail,setDetail]=useState<RecipeMatchWithUsage|null>(null),[shoppingSelection,setShoppingSelection]=useState(false),[matches,setMatches]=useState<RecipeMatchWithUsage[]>([]),[loading,setLoading]=useState(true),[query,setQuery]=useState("");
const openRecipe=async(m:RecipeMatchWithUsage)=>{setDetail(m);if(!familyId)return;try{let resolved=m;if(!resolved.pantryProductsUsed){const lookup=await api.listRecipeSuggestions(familyId,m.recipe.title);const candidate=lookup.suggestions.find(item=>(item.recipe.id??item.recipe.recipeId??"")===m.recipe.id);if(candidate)resolved=mapMatch(candidate);}const result=await api.getRecipe(familyId,m.recipe.id);setDetail(current=>current?.recipe.id===m.recipe.id?{...resolved,recipe:mapRecipeDto(result.recipe)}:current);}catch{/* Keep the available recipe details if an enrichment endpoint is unavailable. */}};
useEffect(() => {
  if (!query.trim()) {
    setMatches(suggestedRecipes.map((recipe)=>mapMatch(recipe)));
    setLoading(false);
    return;
  }

  let cancelled = false;
  setLoading(true);
  const timer = window.setTimeout(() => {
    if (!familyId) return;
    api.listRecipes(familyId, query.trim())
      .then((r) => {
        if (!cancelled) {
          setMatches(r.recipes.map((recipe) =>
            mapMatch({
              recipe,
              score: 1,
              matchedIngredientNames: [],
              missingIngredients: [],
            } as RecipeMatchDto),
          ));
        }
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  }, 350);

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}, [query, familyId, suggestedRecipes]);

const visible = useMemo(
  () => (onlyFeasible ? matches.filter((m) => m.score === 1) : matches),
  [matches, onlyFeasible],
);

if(detail&&shoppingSelection){return <RecipeShoppingSelector familyId={familyId ?? ""} recipeTitle={detail.recipe.title} missingIngredients={detail.missingIngredients} onClose={()=>setShoppingSelection(false)} onComplete={async()=>{await onShoppingChanged?.();setShoppingSelection(false);}}/>;}
if(detail){return <RecipeDetail key={detail.recipe.id} match={detail} stock={stock} setStock={setStock} onBack={()=>setDetail(null)} onShopMissing={()=>setShoppingSelection(true)}/>;}
return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-light" style={{fontFamily:fonts.display,color:colors.ink}}>Ricette</h2><Toggle checked={onlyFeasible} onChange={setOnlyFeasible} label="Solo realizzabili"/></div>
<div className="flex items-center gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca una ricetta per nome…" className="w-full rounded-xl border px-4 py-3 text-sm outline-none" style={{borderColor:colors.border,backgroundColor:colors.white,color:colors.ink}}/>{query&&<button onClick={()=>setQuery("")} className="px-3 py-2 text-sm" style={{color:colors.inkMuted}}>×</button>}</div>{loading?<EmptyState title="Caricamento ricette…" description="Recupero delle ricette dal server."/>:visible.length===0?<EmptyState icon="👨‍🍳" title="Nessuna ricetta disponibile" description={query.trim()?"Nessuna ricetta trovata con questo nome.":onlyFeasible?"Nessuna ricetta è realizzabile con la dispensa attuale.":"Il catalogo ricette non contiene ancora ricette attive."} action={onlyFeasible?{label:"Mostra tutte",onClick:()=>setOnlyFeasible(false)}:undefined}/>:<div className="grid gap-4" style={{gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))"}}>{visible.map(m=>{const pct=Math.round(m.score*100),sc=pct===100?colors.sage:pct>=60?colors.expiring:colors.terracotta;return <button key={m.recipe.id} onClick={()=>{void openRecipe(m)}} className="rounded-2xl overflow-hidden text-left" style={{border:`1px solid ${colors.border}`,backgroundColor:colors.white}}><div className="relative h-40" style={{backgroundColor:colors.border}}>{m.recipe.image&&<img src={m.recipe.image} alt={m.recipe.title} className="w-full h-full object-cover"/>}</div><div className="p-4 space-y-2"><h3 className="font-semibold text-sm">{m.recipe.title}</h3><div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{color:colors.inkMuted}}><span>⏱ {m.recipe.time} min</span><span>📊 {m.recipe.difficulty}</span><span>🔥 {m.recipe.caloriesPerServing} kcal</span></div><div className="h-1 rounded-full" style={{backgroundColor:colors.creamDark}}><div className="h-1 rounded-full" style={{width:`${pct}%`,backgroundColor:sc}}/></div>{m.missingIngredients.length>0&&<p className="text-[10px]" style={{color:colors.terracotta}}>Mancano: {m.missingIngredients.join(", ")}</p>}</div></button>})}</div>}</div>;}
