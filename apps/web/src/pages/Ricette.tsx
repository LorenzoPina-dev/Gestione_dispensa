import { useEffect, useMemo, useState } from "react";
import type { StockItem, ShoppingList, Recipe, RecipeMatch } from "../types";
import type { RecipeMatchDto } from "../api/types";
import * as api from "../api/endpoints";
import { colors, fonts } from "../tokens";
import Toggle from "../components/ui/Toggle";
import SectionHeading from "../components/ui/SectionHeading";
import EmptyState from "../components/ui/EmptyState";

interface Props { stock: StockItem[]; setList: React.Dispatch<React.SetStateAction<ShoppingList>>; familyId?: string | null; }

const QUALITY_META: Record<string,{label:string;color:string;bg:string}> = {
  VERIFIED:{label:"ricetta verificata",color:colors.sageDark,bg:colors.sageLight},
  IMPORTED:{label:"fonte esterna",color:colors.amberDark,bg:colors.amberLight},
  ESTIMATED:{label:"dati stimati",color:colors.inkMuted,bg:colors.creamDark},
  UNKNOWN:{label:"fonte ignota",color:colors.inkMuted,bg:colors.creamDark},
};
function mapMatch(m: RecipeMatchDto): RecipeMatch {
  const r=m.recipe;
  const recipe: Recipe={id:r.id,title:r.title,source:r.source||"",quality:r.quality,servings:r.servings,time:r.timeMinutes,difficulty:r.difficulty,
    ingredients:r.ingredients.map(i=>({name:i.displayName,stockItemId:i.productId,amount:i.amount,unit:i.unit,allergens:i.allergens})),
    steps:r.steps,image:r.image||"",tags:r.tags,caloriesPerServing:r.caloriesPerServing||0};
  return {recipe,score:m.score,matchedIngredients:m.matchedIngredientNames,missingIngredients:m.missingIngredients.map(i=>i.displayName)};
}
export default function Ricette({stock,setList,familyId}:Props){
  const [onlyFeasible,setOnlyFeasible]=useState(false),[detail,setDetail]=useState<RecipeMatch|null>(null),[addedMissing,setAddedMissing]=useState<Set<string>>(new Set()),[matches,setMatches]=useState<RecipeMatch[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{ if(!familyId){setMatches([]);setLoading(false);return;} let cancelled=false;setLoading(true);
    api.listRecipeSuggestions(familyId).then(r=>{if(!cancelled)setMatches(r.suggestions.map(mapMatch));}).catch(()=>{if(!cancelled)setMatches([]);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true};
  },[familyId,stock.length]);
  const visible=useMemo(()=>onlyFeasible?matches.filter(m=>m.score===1):matches,[matches,onlyFeasible]);
  async function addMissingToCart(match:RecipeMatch){
    if(!familyId)return;
    const result=await api.addRecipeMissingIngredients(familyId,match.recipe.id);
    setList(l=>({...l,items:[...l.items,...match.missingIngredients.map((name,i)=>({id:result.itemIds[i]||`recipe-${match.recipe.id}-${i}`,displayName:name,quantity:1,unit:"piece",state:"SUGGESTED" as const,sourceType:"RECIPE" as const,sourceRef:match.recipe.id,version:1}))]}));
    setAddedMissing(s=>new Set(s).add(match.recipe.id));
  }
  if(detail){const qb=QUALITY_META[detail.recipe.quality]||QUALITY_META.UNKNOWN,pct=Math.round(detail.score*100),sc=pct===100?colors.sage:pct>=60?colors.expiring:colors.terracotta,alreadyAdded=addedMissing.has(detail.recipe.id);
    return <div className="space-y-6"><button onClick={()=>setDetail(null)} className="text-sm font-medium" style={{color:colors.inkMuted}}>← Tutte le ricette</button>
      <div className="rounded-2xl overflow-hidden" style={{border:`1px solid ${colors.border}`}}>
        <div className="relative h-52" style={{backgroundColor:colors.border}}>{detail.recipe.image&&<img src={`https://images.unsplash.com/${detail.recipe.image}?w=800&h=400&fit=crop&auto=format`} alt={detail.recipe.title} className="w-full h-full object-cover"/>}
          <div className="absolute bottom-4 left-5 right-5"><h2 className="text-2xl font-light text-white" style={{fontFamily:fonts.display}}>{detail.recipe.title}</h2><div className="flex gap-3 mt-1 text-white/70 text-xs"><span>⏱ {detail.recipe.time} min</span><span>👥 {detail.recipe.servings} porzioni</span><span>📊 {detail.recipe.difficulty}</span><span>🔥 {detail.recipe.caloriesPerServing} kcal/porz.</span></div></div>
        </div>
        <div className="p-5 space-y-5" style={{backgroundColor:colors.white}}>
          <div className="flex justify-between gap-2"><div className="flex gap-2 flex-wrap">{detail.recipe.tags.map(t=><span key={t} className="px-2.5 py-0.5 rounded-full text-xs" style={{backgroundColor:colors.sageLight,color:colors.sageDark}}>{t}</span>)}</div><span className="text-xs px-2 py-0.5 rounded-full" style={{backgroundColor:qb.bg,color:qb.color}}>{qb.label}</span></div>
          <div className="rounded-xl p-3" style={{backgroundColor:colors.cream}}><div className="flex justify-between mb-2"><span className="text-xs font-semibold">{detail.matchedIngredients.length}/{detail.recipe.ingredients.length} ingredienti in dispensa</span><span style={{color:sc}}>{pct}%</span></div><div className="h-1.5 rounded-full" style={{backgroundColor:colors.border}}><div className="h-1.5 rounded-full" style={{width:`${pct}%`,backgroundColor:sc}}/></div></div>
          <div><SectionHeading>Ingredienti</SectionHeading><div className="space-y-1 mt-2">{detail.recipe.ingredients.map(i=>{const ok=detail.matchedIngredients.includes(i.name);return <div key={`${i.name}-${i.amount}`} className="flex justify-between py-2 border-b" style={{borderColor:colors.borderLight}}><span className="text-sm" style={{color:ok?colors.ink:colors.terracotta}}>{ok?"✓":"✗"} {i.name} {i.allergens.length>0&&<small>· {i.allergens.join(", ")}</small>}</span><span className="text-xs" style={{color:colors.inkMuted}}>{i.amount} {i.unit}</span></div>})}</div>
          {detail.missingIngredients.length>0&&<button onClick={()=>void addMissingToCart(detail)} disabled={alreadyAdded} className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium" style={{backgroundColor:alreadyAdded?colors.sageLight:colors.terracotta,color:alreadyAdded?colors.sageDark:colors.white}}>{alreadyAdded?"Ingredienti mancanti aggiunti ✓":`Aggiungi ${detail.missingIngredients.length} ingredienti mancanti alla spesa`}</button>}</div>
          <div><SectionHeading>Preparazione</SectionHeading><ol className="space-y-3 mt-2">{detail.recipe.steps.map((s,i)=><li key={i} className="flex gap-3 text-sm"><span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{backgroundColor:colors.amberLight,color:colors.terracotta}}>{i+1}</span>{s}</li>)}</ol></div>
        </div>
      </div></div>;
  }
  return <div className="space-y-6"><div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-light" style={{fontFamily:fonts.display,color:colors.ink}}>Ricette</h2><Toggle checked={onlyFeasible} onChange={setOnlyFeasible} label="Solo realizzabili"/></div>
    {loading?<EmptyState title="Caricamento ricette…" description="Recupero delle ricette dal server."/>:visible.length===0?<EmptyState icon="👨‍🍳" title="Nessuna ricetta disponibile" description={onlyFeasible?"Nessuna ricetta è realizzabile con la dispensa attuale.":"Il catalogo ricette non contiene ancora ricette attive."} action={onlyFeasible?{label:"Mostra tutte",onClick:()=>setOnlyFeasible(false)}:undefined}/>:<div className="grid gap-4" style={{gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))"}}>{visible.map(m=>{const pct=Math.round(m.score*100),sc=pct===100?colors.sage:pct>=60?colors.expiring:colors.terracotta;return <button key={m.recipe.id} onClick={()=>setDetail(m)} className="rounded-2xl overflow-hidden text-left" style={{border:`1px solid ${colors.border}`,backgroundColor:colors.white}}><div className="relative h-40" style={{backgroundColor:colors.border}}>{m.recipe.image&&<img src={`https://images.unsplash.com/${m.recipe.image}?w=600&h=280&fit=crop&auto=format`} alt={m.recipe.title} className="w-full h-full object-cover"/>}</div><div className="p-4 space-y-2"><h3 className="font-semibold text-sm">{m.recipe.title}</h3><div className="flex gap-3 text-xs" style={{color:colors.inkMuted}}><span>⏱ {m.recipe.time} min</span><span>📊 {m.recipe.difficulty}</span><span>🔥 {m.recipe.caloriesPerServing} kcal</span></div><div className="h-1 rounded-full" style={{backgroundColor:colors.creamDark}}><div className="h-1 rounded-full" style={{width:`${pct}%`,backgroundColor:sc}}/></div>{m.missingIngredients.length>0&&<p className="text-[10px]" style={{color:colors.terracotta}}>Mancano: {m.missingIngredients.join(", ")}</p>}</div></button>})}</div>}
  </div>;
}
