import { useEffect, useMemo, useState } from "react";
import type { ShoppingList, Recipe, RecipeMatch } from "../types";
import type { RecipeMatchDto } from "../api/types";
import * as api from "../api/endpoints";
import { colors, fonts } from "../tokens";
import Toggle from "../components/ui/Toggle";
import SectionHeading from "../components/ui/SectionHeading";
import EmptyState from "../components/ui/EmptyState";
import RecipeShoppingSelector from "../components/recipes/RecipeShoppingSelector";
interface Props { stock: import("../types").StockItem[]; setList: React.Dispatch<React.SetStateAction<ShoppingList>>; onShoppingChanged?: () => Promise<void>; onNavigateToShopping?: () => void; familyId?: string | null; suggestedRecipes?: RecipeMatchDto[]; }
const QUALITY_META:Record<string,{label:string;color:string;bg:string}>={VERIFIED:{label:"ricetta verificata",color:colors.sageDark,bg:colors.sageLight},IMPORTED:{label:"fonte esterna",color:colors.amberDark,bg:colors.amberLight},ESTIMATED:{label:"dati stimati",color:colors.inkMuted,bg:colors.creamDark},UNKNOWN:{label:"fonte ignota",color:colors.inkMuted,bg:colors.creamDark}};
function mapRecipeDto(r:RecipeMatchDto["recipe"]):Recipe{return{id:r.id??r.recipeId??"",title:r.title,source:r.source??"",quality:r.quality??"UNKNOWN",servings:r.servings,time:r.timeMinutes??0,difficulty:r.difficulty??"Facile",ingredients:r.ingredients.map(i=>({name:i.displayName??i.name??i.recipeIngredient??"Ingrediente",stockItemId:i.productId??undefined,amount:i.amount??i.quantity??0,unit:i.unit,allergens:i.allergens??[]})),steps:r.steps,image:r.image??"",tags:r.tags??[],caloriesPerServing:r.caloriesPerServing??0};}
function mapMatch(m:RecipeMatchDto):RecipeMatch{return{recipe:mapRecipeDto(m.recipe),score:m.score,matchedIngredients:(m.matchedIngredientNames??[]).map(name=>name),missingIngredients:m.missingIngredients.map(i=>i.displayName??i.name??i.recipeIngredient??i.canonicalIngredient??"Ingrediente").filter((name):name is string=>Boolean(name.trim()))};}
export default function Ricette({onShoppingChanged,onNavigateToShopping,familyId,suggestedRecipes=[]}:Props){
const[onlyFeasible,setOnlyFeasible]=useState(false),[detail,setDetail]=useState<RecipeMatch|null>(null),[shoppingSelection,setShoppingSelection]=useState(false),[matches,setMatches]=useState<RecipeMatch[]>([]),[loading,setLoading]=useState(true),[query,setQuery]=useState("");
const openRecipe=async(m:RecipeMatch)=>{setDetail(m);if(!familyId)return;try{const result=await api.getRecipe(familyId,m.recipe.id);setDetail(current=>current?.recipe.id===m.recipe.id?{...current,recipe:mapRecipeDto(result.recipe)}:current);}catch{/* Keep the already available suggestion as fallback. */}};
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

if(detail){if(shoppingSelection){return <RecipeShoppingSelector familyId={familyId ?? ""} recipeTitle={detail.recipe.title} missingIngredients={detail.missingIngredients} onClose={()=>setShoppingSelection(false)} onComplete={async()=>{await onShoppingChanged?.();setShoppingSelection(false);}}/>;}const qb=QUALITY_META[detail.recipe.quality]||QUALITY_META.UNKNOWN,pct=Math.round(detail.score*100),sc=pct===100?colors.sage:pct>=60?colors.expiring:colors.terracotta;return <div className="space-y-6"><button onClick={()=>setDetail(null)} aria-label="Torna alle ricette" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium" style={{color:colors.ink,backgroundColor:colors.white,border:`1px solid ${colors.border}`}}><span aria-hidden="true" className="text-lg leading-none">←</span><span>Torna alle ricette</span></button><div className="rounded-2xl overflow-hidden" style={{border:`1px solid ${colors.border}`}}><div className="relative h-52" style={{backgroundColor:colors.border}}>{detail.recipe.image&&<img src={detail.recipe.image} alt={detail.recipe.title} className="w-full h-full object-cover"/>}<div className="absolute bottom-4 left-5 right-5"><h2 className="text-2xl font-light text-white" style={{fontFamily:fonts.display}}>{detail.recipe.title}</h2><div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-white/70 text-xs"><span>⏱ {detail.recipe.time} min</span><span>👥 {detail.recipe.servings} porzioni</span><span>📊 {detail.recipe.difficulty}</span><span>🔥 {detail.recipe.caloriesPerServing} kcal/porz.</span></div></div></div><div className="p-5 space-y-5" style={{backgroundColor:colors.white}}><div className="flex flex-wrap justify-between gap-2"><div className="flex gap-2 flex-wrap">{detail.recipe.tags.map(t=><span key={t} className="px-2.5 py-0.5 rounded-full text-xs" style={{backgroundColor:colors.sageLight,color:colors.sageDark}}>{t}</span>)}</div><span className="text-xs px-2 py-0.5 rounded-full" style={{backgroundColor:qb.bg,color:qb.color}}>{qb.label}</span></div><div className="rounded-xl p-3" style={{backgroundColor:colors.cream}}><div className="flex justify-between mb-2"><span className="text-xs font-semibold">{detail.matchedIngredients.length}/{detail.recipe.ingredients.length} ingredienti in dispensa</span><span style={{color:sc}}>{pct}%</span></div><div className="h-1.5 rounded-full" style={{backgroundColor:colors.border}}><div className="h-1.5 rounded-full" style={{width:`${pct}%`,backgroundColor:sc}}/></div></div><div><SectionHeading>Ingredienti</SectionHeading>{detail.recipe.ingredients.map(i=>{const ok=detail.matchedIngredients.includes(i.name);return <div key={`${i.name}-${i.amount}`} className="flex justify-between py-2 border-b" style={{borderColor:colors.borderLight}}><span className="text-sm" style={{color:ok?colors.ink:colors.terracotta}}>{ok?"✓":"✗"} {i.name}</span><span className="text-xs" style={{color:colors.inkMuted}}>{i.amount} {i.unit}</span></div>})}{detail.missingIngredients.length>0&&<button onClick={()=>setShoppingSelection(true)} className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium" style={{backgroundColor:colors.terracotta,color:colors.white}}>Scegli cosa acquistare · {detail.missingIngredients.length} {detail.missingIngredients.length === 1 ? "mancante" : "mancanti"}</button>}</div><div><SectionHeading>Preparazione</SectionHeading><ol className="space-y-3 mt-2">{detail.recipe.steps.map((s,i)=><li key={i} className="flex gap-3 text-sm"><span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{backgroundColor:colors.amberLight,color:colors.terracotta}}>{i+1}</span>{s}</li>)}</ol></div></div></div></div>}
return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-light" style={{fontFamily:fonts.display,color:colors.ink}}>Ricette</h2><Toggle checked={onlyFeasible} onChange={setOnlyFeasible} label="Solo realizzabili"/></div>
<div className="flex items-center gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca una ricetta per nome…" className="w-full rounded-xl border px-4 py-3 text-sm outline-none" style={{borderColor:colors.border,backgroundColor:colors.white,color:colors.ink}}/>{query&&<button onClick={()=>setQuery("")} className="px-3 py-2 text-sm" style={{color:colors.inkMuted}}>×</button>}</div>{loading?<EmptyState title="Caricamento ricette…" description="Recupero delle ricette dal server."/>:visible.length===0?<EmptyState icon="👨‍🍳" title="Nessuna ricetta disponibile" description={query.trim()?"Nessuna ricetta trovata con questo nome.":onlyFeasible?"Nessuna ricetta è realizzabile con la dispensa attuale.":"Il catalogo ricette non contiene ancora ricette attive."} action={onlyFeasible?{label:"Mostra tutte",onClick:()=>setOnlyFeasible(false)}:undefined}/>:<div className="grid gap-4" style={{gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))"}}>{visible.map(m=>{const pct=Math.round(m.score*100),sc=pct===100?colors.sage:pct>=60?colors.expiring:colors.terracotta;return <button key={m.recipe.id} onClick={()=>{void openRecipe(m)}} className="rounded-2xl overflow-hidden text-left" style={{border:`1px solid ${colors.border}`,backgroundColor:colors.white}}><div className="relative h-40" style={{backgroundColor:colors.border}}>{m.recipe.image&&<img src={m.recipe.image} alt={m.recipe.title} className="w-full h-full object-cover"/>}</div><div className="p-4 space-y-2"><h3 className="font-semibold text-sm">{m.recipe.title}</h3><div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{color:colors.inkMuted}}><span>⏱ {m.recipe.time} min</span><span>📊 {m.recipe.difficulty}</span><span>🔥 {m.recipe.caloriesPerServing} kcal</span></div><div className="h-1 rounded-full" style={{backgroundColor:colors.creamDark}}><div className="h-1 rounded-full" style={{width:`${pct}%`,backgroundColor:sc}}/></div>{m.missingIngredients.length>0&&<p className="text-[10px]" style={{color:colors.terracotta}}>Mancano: {m.missingIngredients.join(", ")}</p>}</div></button>})}</div>}</div>;}
