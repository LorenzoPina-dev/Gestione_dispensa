import type { IngredientMatch, RecipeSubstitution } from "./pantry-recipe-engine.js";
import type { SafetyWarning } from "./safety-engine.js";

export interface RecipePantryProduct {
  productId:string;
  name:string;
  quantity:number;
  unit:string;
  expiresAt:string|null;
  usedBaseQuantity:number;
  usedBaseUnit:"g"|"ml"|"piece";
  usedFor:string[];
}

export interface RecipeNutrition {
  status:"UNAVAILABLE"|"ESTIMATED"|"AVAILABLE";
  total:Record<string,number>|null;
  perServing:Record<string,number>|null;
  coverage:number;
  nutriScoreAverage:number|null;
  nutriScoreCoverage:number;
  nutriScoreScope:"MATCHED_PANTRY_PRODUCTS"|"RECIPE_LEVEL"|"UNAVAILABLE";
  note?:string;
}

export interface RecipeMatch {
  recipeId:string;
  title:string;
  score:number;
  readiness:"READY"|"MINIMAL_SHOPPING"|"DISCARD";
  timeMinutes:number|null;
  difficulty:string|null;
  servings:number|null;
  pantryProductsUsed:RecipePantryProduct[];
  matchedIngredients:IngredientMatch[];
  missingIngredients:IngredientMatch[];
  substitutions:RecipeSubstitution[];
  instructions:string[];
  nutrition:RecipeNutrition;
  safety:{safe:boolean;warnings:SafetyWarning[]};
  coverage:{matched:number;total:number;weightedScore:number;missingCoreCount:number;missingCoreWeight:number};
  availability:{excludedExpiredProductIds:string[]};
  explanation:{ruleVersion:string;quantityAware:boolean;familySafetyApplied:boolean};
}
