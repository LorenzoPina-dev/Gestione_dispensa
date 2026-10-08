import { inferIngredientAllergens, normalizeFoodText } from "@gestione-dispensa/food-rules";

export type SafetySeverity = "BLOCK" | "WARN";
export type SafetyWarningCode = "ALLERGEN" | "TRACE" | "DIETARY_RESTRICTION" | "UNKNOWN_COMPOSITION";
export interface SafetyProfile { allergenTags:string[]; dietaryRestrictions:string[]; tracePolicy:"WARN"|"EXCLUDE"; }
export interface SafetyWarning { code:SafetyWarningCode; severity:SafetySeverity; ingredient:string; details:string; allergenTags?:string[]; }
export interface SafetyIngredient { name:string; canonicalIngredient?:string|null; ingredientTerms?:string[]; }
export interface SafetyPantryProduct { productId:string; name:string; foodSemantics?:{ allergenTags?:string[]; traceTags?:string[]; canonicalIngredient?:string|null; }|null; }

const MEAT=new Set(["pollo","manzo","maiale","pancetta","prosciutto","salsiccia"]);
const ANIMAL=new Set(["pollo","manzo","maiale","pancetta","prosciutto","salsiccia","tonno","salmone"]);

function dietConflicts(restrictions:ReadonlySet<string>,canonical:string|null,allergens:readonly string[]):string[]{
  const conflicts:string[]=[]; const c=canonical?normalizeFoodText(canonical):""; const known=new Set(allergens.map(normalizeFoodText));
  const animal=ANIMAL.has(c), meat=MEAT.has(c);
  if(restrictions.has("vegan")&&animal) conflicts.push("vegan");
  if(restrictions.has("vegetarian")&&meat) conflicts.push("vegetarian");
  if(restrictions.has("pescatarian")&&meat) conflicts.push("pescatarian");
  if(restrictions.has("gluten-free")&&(known.has("gluten")||known.has("wheat"))) conflicts.push("gluten-free");
  if((restrictions.has("dairy-free")||restrictions.has("lactose-free"))&&known.has("milk")) conflicts.push(restrictions.has("dairy-free")?"dairy-free":"lactose-free");
  if(restrictions.has("nut-free")&&known.has("nuts")) conflicts.push("nut-free");
  if(restrictions.has("peanut-free")&&known.has("peanuts")) conflicts.push("peanut-free");
  if(restrictions.has("soy-free")&&known.has("soybeans")) conflicts.push("soy-free");
  if(restrictions.has("egg-free")&&known.has("eggs")) conflicts.push("egg-free");
  if(restrictions.has("fish-free")&&known.has("fish")) conflicts.push("fish-free");
  if(restrictions.has("shellfish-free")&&(known.has("crustaceans")||known.has("molluscs"))) conflicts.push("shellfish-free");
  return [...new Set(conflicts)];
}

export function evaluateRecipeSafety(ingredients:readonly SafetyIngredient[],pantryProducts:readonly SafetyPantryProduct[],profile:SafetyProfile):{safe:boolean;warnings:SafetyWarning[]}{
  const allergic=new Set(profile.allergenTags.map(normalizeFoodText));
  const restrictions=new Set(profile.dietaryRestrictions.map(normalizeFoodText));
  const warnings:SafetyWarning[]=[];
  for(const ingredient of ingredients){
    const inferred=inferIngredientAllergens(ingredient.canonicalIngredient??null,ingredient.ingredientTerms??[]).map(String);
    const direct=inferred.filter(value=>allergic.has(normalizeFoodText(value)));
    if(direct.length) warnings.push({code:"ALLERGEN",severity:"BLOCK",ingredient:ingredient.name,details:"Recipe ingredient conflicts with personal allergen profile.",allergenTags:direct});
    for(const diet of dietConflicts(restrictions,ingredient.canonicalIngredient??null,inferred)) warnings.push({code:"DIETARY_RESTRICTION",severity:"BLOCK",ingredient:ingredient.name,details:"Recipe ingredient conflicts with dietary restriction "+diet+"."});
    if(!ingredient.canonicalIngredient&&(profile.allergenTags.length>0||profile.dietaryRestrictions.length>0)) warnings.push({code:"UNKNOWN_COMPOSITION",severity:"WARN",ingredient:ingredient.name,details:"Ingredient composition could not be normalized safely."});
  }
  for(const product of pantryProducts){
    const semantics=product.foodSemantics;
    if(!semantics){
      if(profile.allergenTags.length||profile.dietaryRestrictions.length) warnings.push({code:"UNKNOWN_COMPOSITION",severity:"WARN",ingredient:product.name,details:"Pantry product has no semantic safety profile."});
      continue;
    }
    const allergens=semantics.allergenTags??[];
    const direct=allergens.filter(value=>allergic.has(normalizeFoodText(value)));
    if(direct.length) warnings.push({code:"ALLERGEN",severity:"BLOCK",ingredient:product.name,details:"Pantry product contains a personal allergen.",allergenTags:direct});
    const traceMatches=(semantics.traceTags??[]).filter(value=>allergic.has(normalizeFoodText(value)));
    if(traceMatches.length) warnings.push({code:"TRACE",severity:profile.tracePolicy==="EXCLUDE"?"BLOCK":"WARN",ingredient:product.name,details:"Pantry product declares an allergen trace.",allergenTags:traceMatches});
    for(const diet of dietConflicts(restrictions,semantics.canonicalIngredient??null,allergens)) warnings.push({code:"DIETARY_RESTRICTION",severity:"BLOCK",ingredient:product.name,details:"Pantry product conflicts with dietary restriction "+diet+"."});
  }
  const deduped=warnings.filter((warning,index,array)=>array.findIndex(other=>other.code===warning.code&&other.ingredient===warning.ingredient&&other.details===warning.details)===index);
  return {safe:!deduped.some(warning=>warning.severity==="BLOCK"),warnings:deduped};
}
