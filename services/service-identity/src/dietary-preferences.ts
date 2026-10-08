import { canonicalAllergenTag, normalizeFoodText } from "@gestione-dispensa/food-rules";
export const DIETARY_RESTRICTIONS = [
  "vegan","vegetarian","pescatarian","gluten-free","lactose-free","dairy-free",
  "nut-free","peanut-free","soy-free","egg-free","fish-free","shellfish-free"
] as const;
export type DietaryRestriction = typeof DIETARY_RESTRICTIONS[number];
export type TracePolicy = "WARN" | "EXCLUDE";
export type UncertaintyPolicy = "WARN" | "EXCLUDE";

const DIET_ALIASES: Readonly<Record<string,DietaryRestriction>> = {
  vegano:"vegan",vegan:"vegan",vegetariano:"vegetarian",vegetarian:"vegetarian",
  pescetariano:"pescatarian",pescatarian:"pescatarian",
  "senza glutine":"gluten-free","gluten free":"gluten-free","gluten-free":"gluten-free",
  "senza lattosio":"lactose-free","lactose free":"lactose-free","lactose-free":"lactose-free",
  "senza latticini":"dairy-free","dairy free":"dairy-free","dairy-free":"dairy-free",
  "senza frutta secca":"nut-free","nut free":"nut-free","nut-free":"nut-free",
  "senza arachidi":"peanut-free","peanut free":"peanut-free","peanut-free":"peanut-free",
  "senza soia":"soy-free","soy free":"soy-free","soy-free":"soy-free",
  "senza uova":"egg-free","egg free":"egg-free","egg-free":"egg-free",
  "senza pesce":"fish-free","fish free":"fish-free","fish-free":"fish-free",
  "senza crostacei":"shellfish-free","shellfish free":"shellfish-free","shellfish-free":"shellfish-free"
};

export interface DietaryPreferencesInput {
  allergenTags?: unknown;
  dietaryRestrictions?: unknown;
  tracePolicy?: unknown;
  uncertaintyPolicy?: unknown;
}

export interface NormalizedDietaryPreferences {
  allergenTags: string[];
  dietaryRestrictions: DietaryRestriction[];
  tracePolicy: TracePolicy;
  uncertaintyPolicy: UncertaintyPolicy;
}

export function normalizeDietaryPreferences(input: DietaryPreferencesInput): { value?: NormalizedDietaryPreferences; issues: string[] } {
  const issues:string[]=[];
  const rawAllergens=input.allergenTags===undefined ? [] : input.allergenTags;
  const rawDiet=input.dietaryRestrictions===undefined ? [] : input.dietaryRestrictions;
  if(!Array.isArray(rawAllergens)||!rawAllergens.every(x=>typeof x==="string")) issues.push("allergenTags must be an array of strings.");
  if(!Array.isArray(rawDiet)||!rawDiet.every(x=>typeof x==="string")) issues.push("dietaryRestrictions must be an array of strings.");
  const rawTrace=input.tracePolicy===undefined ? "WARN" : input.tracePolicy;
  const rawUncertainty=input.uncertaintyPolicy===undefined ? "EXCLUDE" : input.uncertaintyPolicy;
  if(rawTrace!=="WARN"&&rawTrace!=="EXCLUDE") issues.push("tracePolicy must be WARN or EXCLUDE.");
  if(rawUncertainty!=="WARN"&&rawUncertainty!=="EXCLUDE") issues.push("uncertaintyPolicy must be WARN or EXCLUDE.");
  if(issues.length)return {issues};

  const allergens:string[]=[];
  for(const raw of rawAllergens as string[]){
    const code=canonicalAllergenTag(raw);
    if(!code) issues.push("Unsupported allergen: "+raw.trim());
    else if(!allergens.includes(code)) allergens.push(code);
  }

  const restrictions:DietaryRestriction[]=[];
  for(const raw of rawDiet as string[]){
    const key=normalizeFoodText(raw);
    const restriction=DIET_ALIASES[key];
    if(!restriction) issues.push("Unsupported dietary restriction: "+raw.trim());
    else if(!restrictions.includes(restriction)) restrictions.push(restriction);
  }
  if(issues.length)return {issues};
  return {value:{allergenTags:allergens,dietaryRestrictions:restrictions,tracePolicy:rawTrace as TracePolicy,uncertaintyPolicy:rawUncertainty as UncertaintyPolicy},issues:[]};
}
