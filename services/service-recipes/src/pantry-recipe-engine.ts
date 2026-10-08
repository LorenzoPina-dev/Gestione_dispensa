import { foodQuantity, foodSemanticRelation, functionalSubstitution, normalizeFoodText } from "@gestione-dispensa/food-rules";
import { combineInventoryQuantity, quantityCoverage, type ParsedQuantity } from "./quantity-engine.js";

export type CulinaryWeight = "STAPLE" | "SECONDARY" | "CORE";
export type Readiness = "READY" | "MINIMAL_SHOPPING" | "DISCARD";

export interface RecipeIngredientForMatch {
  id?: string;
  name: string;
  displayName: string;
  canonicalIngredient?: string | null;
  semanticConfidence?: number;
  ingredientTerms?: string[];
  culinaryWeight?: CulinaryWeight;
  quantityValue?: number | null;
  quantityUnit?: string | null;
  quantityDimension?: "mass" | "volume" | "count" | null;
  quantityBaseValue?: number | null;
  quantityBaseUnit?: "g" | "ml" | "piece" | null;
  quantityConfidence?: number;
}

export interface PantryProductForMatch {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  expiresAt?: string | null;
  addedAt?: string | null;
  openedAt?: string | null;
  remainingContentQuantity?: number | null;
  remainingContentUnit?: "g" | "kg" | "ml" | "l" | "piece" | null;
  foodSemantics?: {
    canonicalIngredient?: string | null;
    semanticConfidence?: number;
    ingredientTerms?: string[];
    taxonomyTags?: string[];
    quantityBase?: { value: number; unit: "g" | "ml" | "piece" } | null;
    nutriScoreGrade?: string | null;
  } | null;
  nutrition?: {
    kcalPer100g?: number | null;
    proteinGPer100g?: number | null;
    carbsGPer100g?: number | null;
    fatGPer100g?: number | null;
    fiberGPer100g?: number | null;
  } | null;
}

export interface IngredientMatch {
  recipeIngredient: string;
  canonicalIngredient: string | null;
  culinaryWeight: CulinaryWeight;
  status: "COMPLETE" | "PARTIAL" | "MISSING" | "PRESENCE_ONLY" | "INCOMPATIBLE" | "UNKNOWN" | "SUBSTITUTED";
  ratio: number;
  requiredQuantity: { value: number; unit: string } | null;
  availableQuantity: { value: number; unit: string } | null;
  missingQuantity: { value: number; unit: string } | null;
  productIds: string[];
  allocations: Array<{
    productId: string;
    usedBaseValue: number;
    baseUnit: "g" | "ml" | "piece";
    effectiveBaseValue: number;
    factor: number;
    expiresAt: string | null;
  }>;
  confidence: number;
  substitution?: {
    fromIngredient: string;
    toIngredient: string;
    factor: number;
    reason: string;
    productIds: string[];
  };
}

export interface RecipeSubstitution {
  recipeIngredient: string;
  fromIngredient: string;
  toIngredient: string;
  factor: number;
  reason: string;
  productIds: string[];
}

export interface RecipeNutritionEstimate {
  status:"UNAVAILABLE"|"ESTIMATED";
  total:Record<string,number>|null;
  coverage:number;
  ingredientsWithNutrition:number;
  ingredientsWithoutNutrition:number;
  gramsWithNutrition:number;
  gramsWithoutNutrition:number;
  perServing:Record<string,number>|null;
  note:string;
}

export function estimateRecipeNutrition(
  matches:readonly IngredientMatch[],
  pantry:readonly PantryProductForMatch[],
  servings:number|null=null,
): RecipeNutritionEstimate {
  const byProduct=new Map(pantry.map(item=>[item.productId,item]));
  const totals={caloriesKcal:0,proteinG:0,carbsG:0,fatG:0,fiberG:0};
  let ingredientsWithNutrition=0;
  let ingredientsWithoutNutrition=0;
  let gramsWithNutrition=0;
  let gramsWithoutNutrition=0;

  for(const match of matches){
    if(match.allocations.length===0){
      if(match.status==="PRESENCE_ONLY" && match.productIds.some(id=>byProduct.get(id)?.nutrition)) ingredientsWithNutrition++;
      else ingredientsWithoutNutrition++;
      continue;
    }
    let ingredientHasNutrition=false;
    let ingredientHasUnsupportedBasis=false;
    for(const allocation of match.allocations){
      const product=byProduct.get(allocation.productId);
      const nutrition=product?.nutrition;
      const grams=allocation.baseUnit==="g"?allocation.usedBaseValue:0;
      if(!nutrition || allocation.baseUnit!=="g"){
        if(allocation.baseUnit==="g") gramsWithoutNutrition+=allocation.usedBaseValue;
        else ingredientHasUnsupportedBasis=true;
        continue;
      }
      const values=[
        ["caloriesKcal","kcalPer100g",nutrition.kcalPer100g],
        ["proteinG","proteinGPer100g",nutrition.proteinGPer100g],
        ["carbsG","carbsGPer100g",nutrition.carbsGPer100g],
        ["fatG","fatGPer100g",nutrition.fatGPer100g],
        ["fiberG","fiberGPer100g",nutrition.fiberGPer100g],
      ] as const;
      let contributed=false;
      for(const [target,source,value] of values){
        if(typeof value==="number"&&Number.isFinite(value)){
          totals[target]+=grams*value/100;
          contributed=true;
        }
      }
      if(contributed){
        ingredientHasNutrition=true;
        gramsWithNutrition+=grams;
      }else{
        gramsWithoutNutrition+=grams;
      }
    }
    if(ingredientHasNutrition)ingredientsWithNutrition++;
    else if(ingredientHasUnsupportedBasis||match.allocations.length>0)ingredientsWithoutNutrition++;
  }

  const totalAllocatedGrams=gramsWithNutrition+gramsWithoutNutrition;
  const coverage=totalAllocatedGrams>0
    ? Number((gramsWithNutrition/totalAllocatedGrams).toFixed(3))
    : 0;
  if(ingredientsWithNutrition===0){
    return {
      status:"UNAVAILABLE",
      total:null,
      coverage:0,
      ingredientsWithNutrition:0,
      ingredientsWithoutNutrition,
      gramsWithNutrition:0,
      gramsWithoutNutrition,
      perServing:null,
      note:"No matched pantry allocation has reliable nutrition on a gram basis.",
    };
  }
  const total=Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,Number(value.toFixed(2))]));
  const perServing=typeof servings==="number"&&Number.isFinite(servings)&&servings>0
    ? Object.fromEntries(Object.entries(total).map(([key,value])=>[key,Number((value/servings).toFixed(2))]))
    : null;
  return {
    status:"ESTIMATED",
    total,
    coverage,
    ingredientsWithNutrition,
    ingredientsWithoutNutrition,
    gramsWithNutrition:Number(gramsWithNutrition.toFixed(3)),
    gramsWithoutNutrition:Number(gramsWithoutNutrition.toFixed(3)),
    perServing,
    note:coverage<0.999
      ?"Estimated only from matched pantry products with reliable per-100 g nutrition; missing or non-gram ingredients are excluded."
      :"Estimated from matched pantry products with reliable per-100 g nutrition. This is not a source-provided recipe nutrition profile.",
  };
}

export function averageNutriScore(
  pantry: readonly PantryProductForMatch[],
  productIds: readonly string[],
): { average:number|null; coverage:number } {
  const used=new Set(productIds);
  const values=pantry
    .filter(item=>used.has(item.productId))
    .map(item=>item.foodSemantics?.nutriScoreGrade?.toLowerCase() ?? "")
    .map(grade=>({a:1,b:2,c:3,d:4,e:5}[grade] ?? null))
    .filter((value): value is number => value !== null);
  return {
    average:values.length ? Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(3)) : null,
    coverage:used.size ? Number((values.length/used.size).toFixed(3)) : 0,
  };
}

export interface PantryRecipeScore {
  score: number;
  readiness: Readiness;
  matchedIngredients: IngredientMatch[];
  missingIngredients: IngredientMatch[];
  substitutions: RecipeSubstitution[];
  matchedProductIds: string[];
  missingCoreCount: number;
  missingCoreWeight: number;
  excludedExpiredProductIds: string[];
}

function isExpired(item: PantryProductForMatch, nowMs: number): boolean {
  if (!item.expiresAt) return false;
  const expiresMs = Date.parse(item.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

function normalizeTerms(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizeFoodText).filter(Boolean));
}

function exactSemanticMatch(recipe: RecipeIngredientForMatch, pantry: PantryProductForMatch): boolean {
  const recipeCanonical = normalizeFoodText(recipe.canonicalIngredient ?? "");
  const pantryCanonical = normalizeFoodText(pantry.foodSemantics?.canonicalIngredient ?? "");
  const recipeConfidence = recipe.semanticConfidence ?? 1;
  const pantryConfidence = pantry.foodSemantics?.semanticConfidence ?? 1;
  if (recipeConfidence < 0.8 || pantryConfidence < 0.8) return false;
  const relation = foodSemanticRelation(recipeCanonical || null, pantryCanonical || null);
  if (relation === "EXACT" || relation === "SYNONYM" || relation === "RECIPE_GENERALIZES_PRODUCT") return true;
  if (relation === "UNSAFE_GENERALIZATION") return false;
  if (recipeCanonical && pantryCanonical) return false;
  const recipeTerms = normalizeTerms([...(recipe.ingredientTerms ?? []), recipe.name, recipe.displayName]);
  const pantryTerms = normalizeTerms([...(pantry.foodSemantics?.ingredientTerms ?? []), ...(pantry.foodSemantics?.taxonomyTags ?? []), pantry.name]);
  for (const term of recipeTerms) if (pantryTerms.has(term)) return true;
  return false;
}

function toRequiredQuantity(ingredient: RecipeIngredientForMatch): ParsedQuantity | null {
  if (typeof ingredient.quantityBaseValue === "number" && ingredient.quantityBaseValue > 0 && ingredient.quantityBaseUnit) {
    const dimension = ingredient.quantityDimension ?? (
      ingredient.quantityBaseUnit === "g" ? "mass" :
      ingredient.quantityBaseUnit === "ml" ? "volume" : "count"
    );
    return {
      value: typeof ingredient.quantityValue === "number" ? ingredient.quantityValue : ingredient.quantityBaseValue,
      unit: ingredient.quantityUnit ?? ingredient.quantityBaseUnit,
      dimension,
      baseValue: ingredient.quantityBaseValue,
      baseUnit: ingredient.quantityBaseUnit,
      confidence: ingredient.quantityConfidence ?? 0,
      sourceRaw: String(ingredient.quantityBaseValue) + " " + ingredient.quantityBaseUnit,
    };
  }
  if (typeof ingredient.quantityValue === "number" && ingredient.quantityValue > 0 && ingredient.quantityUnit) {
    const parsed = foodQuantity(ingredient.quantityValue, ingredient.quantityUnit);
    if (!parsed) return null;
    return {
      value: parsed.value,
      unit: parsed.unit,
      dimension: parsed.dimension,
      baseValue: parsed.baseValue,
      baseUnit: parsed.baseUnit,
      confidence: ingredient.quantityConfidence ?? 1,
      sourceRaw: parsed.sourceRaw,
    };
  }
  return null;
}

function sortFefo(items: readonly PantryProductForMatch[]): PantryProductForMatch[] {
  return [...items].sort((a,b)=>{
    const ae=a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY;
    const be=b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY;
    if(ae!==be)return ae-be;
    const aa=a.addedAt ? Date.parse(a.addedAt) : Number.POSITIVE_INFINITY;
    const ba=b.addedAt ? Date.parse(b.addedAt) : Number.POSITIVE_INFINITY;
    return aa-ba;
  });
}

function allocateBaseQuantity(
  candidates: readonly PantryProductForMatch[],
  requiredBaseValue: number,
  dimension: ParsedQuantity["dimension"],
  factor: number,
): {
  allocations:Array<{
    productId:string;
    usedBaseValue:number;
    baseUnit:"g"|"ml"|"piece";
    effectiveBaseValue:number;
    factor:number;
    expiresAt:string|null;
  }>;
  rawUsed:number;
  effectiveUsed:number;
} {
  let remaining=Math.max(0,requiredBaseValue);
  const allocations:Array<{
    productId:string;
    usedBaseValue:number;
    baseUnit:"g"|"ml"|"piece";
    effectiveBaseValue:number;
    factor:number;
    expiresAt:string|null;
  }>=[];
  for(const item of sortFefo(candidates)){
    if(remaining<=0)break;
    const parsed=combineInventoryQuantity(item.quantity,item.unit,item.foodSemantics?.quantityBase??null,item.openedAt??null,item.remainingContentQuantity!=null&&item.remainingContentUnit?{value:item.remainingContentQuantity,unit:item.remainingContentUnit}:null);
    if(!parsed||parsed.dimension!==dimension||parsed.baseValue<=0)continue;
    const neededRaw=remaining/Math.max(factor,0.000001);
    const used=Math.min(parsed.baseValue,neededRaw);
    if(used<=0)continue;
    allocations.push({
      productId:item.productId,
      usedBaseValue:Number(used.toFixed(6)),
      baseUnit:parsed.baseUnit,
      effectiveBaseValue:Number((used*factor).toFixed(6)),
      factor,
      expiresAt:item.expiresAt??null,
    });
    remaining=Math.max(0,remaining-used*factor);
  }
  const rawUsed=allocations.reduce((sum,item)=>sum+item.usedBaseValue,0);
  const effectiveUsed=allocations.reduce((sum,item)=>sum+item.effectiveBaseValue,0);
  return {allocations,rawUsed,effectiveUsed};
}

function inventoryQuantities(pantry: readonly PantryProductForMatch[]): ParsedQuantity[] {
  return pantry
    .map(item => combineInventoryQuantity(item.quantity, item.unit, item.foodSemantics?.quantityBase ?? null))
    .filter((value): value is ParsedQuantity => value !== null);
}

export function scoreRecipeAgainstPantry(
  ingredients: readonly RecipeIngredientForMatch[],
  pantry: readonly PantryProductForMatch[],
  options: { now?: Date } = {},
): PantryRecipeScore {
  const nowMs = (options.now ?? new Date()).getTime();
  const excludedExpiredProductIds = pantry.filter(item => isExpired(item, nowMs)).map(item => item.productId);
  const usablePantry = pantry.filter(item => !isExpired(item, nowMs));
  const groups = new Map<string, RecipeIngredientForMatch[]>();
  for (const ingredient of ingredients) {
    const key = normalizeFoodText(ingredient.canonicalIngredient ?? "") || normalizeFoodText(ingredient.displayName || ingredient.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ingredient);
  }

  const matches: IngredientMatch[] = [];
  const substitutions: RecipeSubstitution[] = [];
  let weightedTotal = 0;
  let weightedMatched = 0;
  const matchedProductIds = new Set<string>();

  for (const group of groups.values()) {
    const representative = group[0];
    const weight = representative.culinaryWeight ?? "CORE";
    const groupWeight = group.reduce(
      (sum, item) => sum + (item.culinaryWeight === "STAPLE" ? 0.1 : item.culinaryWeight === "SECONDARY" ? 0.5 : 1),
      0,
    );
    const quantities = group.map(toRequiredQuantity);
    const allKnownQuantity = quantities.length > 0 && quantities.every(Boolean);
    const firstQuantity = quantities.find(Boolean) as ParsedQuantity | undefined;
    const dimension = firstQuantity?.dimension ?? null;
    const required = allKnownQuantity && dimension && quantities.every(item => (item as ParsedQuantity).dimension === dimension)
      ? quantities.reduce((sum, item) => sum + (item as ParsedQuantity).baseValue, 0)
      : null;

    const exactCandidates = usablePantry.filter(item => group.some(ingredient => exactSemanticMatch(ingredient, item)));
    const substituteCandidates = usablePantry.filter(item =>
      exactCandidates.every(candidate => candidate.productId !== item.productId) &&
      group.some(ingredient => Boolean(functionalSubstitution(
        ingredient.canonicalIngredient ?? null,
        item.foodSemantics?.canonicalIngredient ?? null,
      ))),
    );

    const exactAvailable = inventoryQuantities(exactCandidates);

    let match: IngredientMatch;

    if (exactCandidates.length === 0 && substituteCandidates.length === 0) {
      match = {
        recipeIngredient: representative.displayName || representative.name,
        canonicalIngredient: representative.canonicalIngredient ?? null,
        culinaryWeight: weight,
        status: "MISSING",
        ratio: 0,
        requiredQuantity: required !== null ? { value: required, unit: firstQuantity!.baseUnit } : null,
        availableQuantity: null,
        missingQuantity: required !== null ? { value: required, unit: firstQuantity!.baseUnit } : null,
        productIds: [],
        allocations: [],
        confidence: Math.min(...group.map(item => item.quantityConfidence ?? 0.5)),
      };
    } else if (required === null) {
      if (exactCandidates.length > 0) {
        match = {
          recipeIngredient: representative.displayName || representative.name,
          canonicalIngredient: representative.canonicalIngredient ?? null,
          culinaryWeight: weight,
          status: "PRESENCE_ONLY",
          ratio: 1,
          requiredQuantity: null,
          availableQuantity: null,
          missingQuantity: null,
          productIds: exactCandidates.length ? [sortFefo(exactCandidates)[0]!.productId] : [],
          allocations: [],
          confidence: Math.min(1, Math.max(0.5, ...exactCandidates.map(item => item.foodSemantics ? 1 : 0.7))),
        };
      } else {
        const firstSub = group
          .map(ingredient => substituteCandidates
            .map(item => functionalSubstitution(ingredient.canonicalIngredient ?? null, item.foodSemantics?.canonicalIngredient ?? null))
            .find(Boolean))
          .find(Boolean);
        const firstSubstituteProduct = sortFefo(substituteCandidates)[0];
        const productIds = firstSubstituteProduct ? [firstSubstituteProduct.productId] : [];
        match = {
          recipeIngredient: representative.displayName || representative.name,
          canonicalIngredient: representative.canonicalIngredient ?? null,
          culinaryWeight: weight,
          status: "SUBSTITUTED",
          ratio: firstSub?.factor ?? 0.8,
          requiredQuantity: null,
          availableQuantity: null,
          missingQuantity: null,
          productIds,
          allocations: [],
          confidence: Math.min(0.9, Math.max(0.5, ...substituteCandidates.map(item => item.foodSemantics ? 0.9 : 0.7))),
          substitution: firstSub ? {
            fromIngredient: firstSub.fromCanonical,
            toIngredient: firstSub.toCanonical,
            factor: firstSub.factor,
            reason: firstSub.reason,
            productIds,
          } : undefined,
        };
        if (match.substitution) substitutions.push({
          recipeIngredient: match.recipeIngredient,
          fromIngredient: match.substitution.fromIngredient,
          toIngredient: match.substitution.toIngredient,
          factor: match.substitution.factor,
          reason: match.substitution.reason,
          productIds,
        });
      }
    } else {
      const requiredQuantity: ParsedQuantity = {
        value: required,
        unit: firstQuantity!.unit,
        dimension: firstQuantity!.dimension,
        baseValue: required,
        baseUnit: firstQuantity!.baseUnit,
        confidence: Math.min(...quantities.map(item => (item as ParsedQuantity).confidence)),
        sourceRaw: String(required) + " " + firstQuantity!.baseUnit,
      };
      const exactCoverage = quantityCoverage(requiredQuantity, exactAvailable);
      const exactAllocation = allocateBaseQuantity(exactCandidates, required, requiredQuantity.dimension, 1);
      const exactUsed = exactAllocation.effectiveUsed;
      const remaining = Math.max(0, required - exactUsed);
      const compatibleSub = substituteCandidates.filter(item => {
        const parsed=combineInventoryQuantity(item.quantity,item.unit,item.foodSemantics?.quantityBase??null);
        return Boolean(parsed && parsed.dimension===requiredQuantity.dimension);
      });
      const substituteAllocation = allocateBaseQuantity(compatibleSub, remaining, requiredQuantity.dimension, 0.8);
      const substituteUsed = substituteAllocation.effectiveUsed;
      const effective = exactUsed + substituteUsed;
      const ratio = Math.max(0, Math.min(1, effective / required));
      const allocations=[...exactAllocation.allocations,...substituteAllocation.allocations];
      const ids=[...new Set(allocations.map(item=>item.productId))];
      const incompatibleSub = substituteCandidates.length > 0 && compatibleSub.length === 0;

      const subRule = substituteUsed > 0
        ? group
          .map(ingredient => substituteCandidates
            .map(item => functionalSubstitution(ingredient.canonicalIngredient ?? null, item.foodSemantics?.canonicalIngredient ?? null))
            .find(Boolean))
          .find(Boolean)
        : null;

      let status: IngredientMatch["status"] = ratio >= 1 && substituteUsed === 0
        ? "COMPLETE"
        : substituteUsed > 0
          ? "SUBSTITUTED"
          : exactCoverage.status;

      if (ratio === 0 && incompatibleSub && exactCandidates.length === 0) status = "INCOMPATIBLE";

      match = {
        recipeIngredient: representative.displayName || representative.name,
        canonicalIngredient: representative.canonicalIngredient ?? null,
        culinaryWeight: weight,
        status,
        ratio: Number(ratio.toFixed(4)),
        requiredQuantity: { value: required, unit: requiredQuantity.baseUnit },
        availableQuantity: { value: Math.min(required, exactUsed + substituteUsed), unit: requiredQuantity.baseUnit },
        missingQuantity: {
          value: Math.max(0, required - exactUsed - substituteUsed),
          unit: requiredQuantity.baseUnit,
        },
        productIds: ids,
        allocations,
        confidence: requiredQuantity.confidence,
        substitution: subRule ? {
          fromIngredient: subRule.fromCanonical,
          toIngredient: subRule.toCanonical,
          factor: subRule.factor,
          reason: subRule.reason,
          productIds: substituteCandidates.map(item => item.productId),
        } : undefined,
      };

      if (match.substitution) substitutions.push({
        recipeIngredient: match.recipeIngredient,
        fromIngredient: match.substitution.fromIngredient,
        toIngredient: match.substitution.toIngredient,
        factor: match.substitution.factor,
        reason: match.substitution.reason,
        productIds: match.substitution.productIds,
      });
    }

    matches.push(match);
    weightedTotal += groupWeight;
    weightedMatched += groupWeight * match.ratio;
    for (const id of match.productIds) matchedProductIds.add(id);
  }

  const score = weightedTotal > 0
    ? Number(Math.max(0, Math.min(1, weightedMatched / weightedTotal)).toFixed(4))
    : 0;
  const missingIngredients = matches.filter(item => item.ratio < 1);
  const missingCoreCount = missingIngredients.filter(item => item.culinaryWeight === "CORE").length;
  const missingCoreWeight = missingIngredients
    .filter(item => item.culinaryWeight === "CORE")
    .reduce((sum, item) => sum + (1 - item.ratio), 0);

  return {
    score,
    readiness: score >= 0.8 ? "READY" : score >= 0.5 ? "MINIMAL_SHOPPING" : "DISCARD",
    matchedIngredients: matches,
    missingIngredients,
    substitutions,
    matchedProductIds: [...matchedProductIds],
    missingCoreCount,
    missingCoreWeight: Number(missingCoreWeight.toFixed(4)),
    excludedExpiredProductIds,
  };
}
