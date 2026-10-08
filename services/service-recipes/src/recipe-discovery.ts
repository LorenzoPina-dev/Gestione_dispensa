import type { Pool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { ingredientTerms, normalizeFoodText as norm } from "@gestione-dispensa/food-rules";
import { averageNutriScore, scoreRecipeAgainstPantry } from "./pantry-recipe-engine.js";
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
type PantryItem={productId?:string|null;name?:string;quantity?:number;unit?:string;expiresAt?:string|null;addedAt?:string|null;openedAt?:string|null;remainingContentQuantity?:number|null;remainingContentUnit?:"g"|"kg"|"ml"|"l"|"piece"|null;foodSemantics?:FoodSemantics|null};

type CatalogProduct={productId:string;name?:string|null;foodSemantics?:FoodSemantics|null};
type Suggestion=RecipeMatch & { matchedIngredientNames:string[]; matchedProducts:string[]; safetyWarnings:RecipeMatch["safety"]["warnings"]; recipe:Record<string,unknown> };

const IMAGE_CACHE = new Map<string, string | null>();
const STEPS_CACHE = new Map<string, string[] | null>();

async function getInventory(base:string,userId:string,familyId:string,authorization?:string):Promise<PantryItem[]>{
 const u=new URL(base.replace(/\/$/,"")+"/inventory");u.searchParams.set("familyId",familyId);u.searchParams.set("status","current");u.searchParams.set("limit","100");
 const headers:Record<string,string>={"x-user-id":userId,"x-family-id":familyId,accept:"application/json"};if(authorization)headers.authorization=authorization;
 const r=await fetch(u,{headers,signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error("inventory HTTP "+r.status);const b=await r.json() as {items?:PantryItem[]};return b.items??[];