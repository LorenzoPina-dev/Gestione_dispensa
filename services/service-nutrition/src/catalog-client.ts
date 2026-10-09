export type NutritionConfidence = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";

export interface NutritionSnapshot {
  productName: string;
  brand: string | null;
  caloriesKcalPer100g: number | null;
  proteinGPer100g: number | null;
  carbsGPer100g: number | null;
  fatGPer100g: number | null;
  fiberGPer100g: number | null;
  caloriesKcalPer100ml: number | null;
  proteinGPer100ml: number | null;
  carbsGPer100ml: number | null;
  fatGPer100ml: number | null;
  fiberGPer100ml: number | null;
  source: string;
  sourceProductVersion: number | null;
  confidence: NutritionConfidence;
  packageQuantityValue: number | null;
  packageQuantityUnit: string | null;
  servingQuantity: number | null;
  servingUnit: string | null;
}

export interface CalculatedNutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  confidence: NutritionConfidence;
}

type RecordValue = Record<string, unknown>;
type NutritionBasis = "g" | "ml";
type QuantityBasis = { basis: NutritionBasis; amount: number };

const nutritionCache = new Map<string, { expiresAt: number; value: NutritionSnapshot | null }>();
const CACHE_TTL_MS = 60_000;

export async function loadNutritionSnapshot(
  baseUrl: string,
  authorization: string | undefined,
  productId: string,
  internalToken?: string,
): Promise<NutritionSnapshot | null> {
  const cached = nutritionCache.get(productId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const path = internalToken ? "catalog/internal/products/" + encodeURIComponent(productId) : "catalog/products/" + encodeURIComponent(productId);
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(path, normalizedBaseUrl + "/");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;
  if (internalToken) headers["x-internal-service-token"] = internalToken;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(2500) });
  if (response.status === 404) {
    cacheNutrition(productId, null);
    return null;
  }
  if (!response.ok) throw new Error("Catalog nutrition lookup failed with HTTP " + response.status);
  const body = await response.json() as { data?: RecordValue };
  const data = body.data;
  if (!data) return null;

  const nutrition = record(data.nutrition);
  const openFoodFacts = record(data.openFoodFacts);
  const rawNutriments = record(openFoodFacts?.nutriments) ?? {};
  const read = (...values: unknown[]): number | null => {
    for (const value of values) {
      const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const energyKcal = (basis: "100g" | "100ml", ...projected: unknown[]): number | null => {
    const direct = read(...projected, rawNutriments[`energy-kcal_${basis}`]);
    if (direct !== null) return direct;
    const kilojoules = read(rawNutriments[`energy-kj_${basis}`]);
    return kilojoules === null ? null : kilojoules / 4.184;
  };
  const per100g = {
    calories: energyKcal("100g", nutrition?.kcalPer100g),
    protein: read(nutrition?.proteinGPer100g, rawNutriments.proteins_100g),
    carbs: read(nutrition?.carbsGPer100g, rawNutriments.carbohydrates_100g),
    fat: read(nutrition?.fatGPer100g, rawNutriments.fat_100g),
    fiber: read(nutrition?.fiberGPer100g, rawNutriments.fiber_100g),
  };
  const per100ml = {
    calories: energyKcal("100ml", nutrition?.kcalPer100ml, rawNutriments["energy-kcal_100ml"]),
    protein: read(nutrition?.proteinGPer100ml, rawNutriments.proteins_100ml),
    carbs: read(nutrition?.carbsGPer100ml, rawNutriments.carbohydrates_100ml),
    fat: read(nutrition?.fatGPer100ml, rawNutriments.fat_100ml),
    fiber: read(nutrition?.fiberGPer100ml, rawNutriments.fiber_100ml),
  };
  const hasNutrition = [...Object.values(per100g), ...Object.values(per100ml)].some((value) => value !== null);
  const source = record(data.source)?.type;
  const confidence: NutritionConfidence =
    !hasNutrition ? "UNKNOWN" : source === "manual" ? "CONFIRMED" : "ESTIMATED";
  const packageInfo = record(data.package);
  const servingInfo = record(data.serving);
  const snapshot: NutritionSnapshot = {
    productName: typeof data.name === "string" && data.name.trim() ? data.name.trim() : productId,
    brand: typeof data.brand === "string" && data.brand.trim() ? data.brand.trim() : null,
    caloriesKcalPer100g: per100g.calories,
    proteinGPer100g: per100g.protein,
    carbsGPer100g: per100g.carbs,
    fatGPer100g: per100g.fat,
    fiberGPer100g: per100g.fiber,
    caloriesKcalPer100ml: per100ml.calories,
    proteinGPer100ml: per100ml.protein,
    carbsGPer100ml: per100ml.carbs,
    fatGPer100ml: per100ml.fat,
    fiberGPer100ml: per100ml.fiber,
    source: typeof source === "string" ? source : "unknown",
    sourceProductVersion: typeof data.version === "number" ? data.version : null,
    confidence,
    packageQuantityValue: typeof packageInfo?.value === "number" ? packageInfo.value : null,
    packageQuantityUnit: typeof packageInfo?.unit === "string" ? packageInfo.unit : null,
    servingQuantity: typeof servingInfo?.quantity === "number" ? servingInfo.quantity : null,
    servingUnit: typeof servingInfo?.unit === "string" ? servingInfo.unit : null,
  };
  cacheNutrition(productId, snapshot);
  return snapshot;
}

function cacheNutrition(productId: string, value: NutritionSnapshot | null): void {
  nutritionCache.set(productId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  if (nutritionCache.size > 500) {
    const oldest = nutritionCache.keys().next().value;
    if (oldest !== undefined) nutritionCache.delete(oldest);
  }
}

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().split(" ").join("");
}

function quantityInNutritionBasis(quantity: number, unit: string): QuantityBasis | null {
  const normalized = normalizeUnit(unit);
  if (normalized === "g" || normalized === "gram" || normalized === "grams") return { basis: "g", amount: quantity };
  if (normalized === "kg" || normalized === "kilogram" || normalized === "kilograms") return { basis: "g", amount: quantity * 1000 };
  if (normalized === "mg" || normalized === "milligram" || normalized === "milligrams") return { basis: "g", amount: quantity / 1000 };
  if (normalized === "ml" || normalized === "milliliter" || normalized === "millilitre") return { basis: "ml", amount: quantity };
  if (normalized === "cl") return { basis: "ml", amount: quantity * 10 };
  if (normalized === "dl") return { basis: "ml", amount: quantity * 100 };
  if (normalized === "l" || normalized === "liter" || normalized === "litre") return { basis: "ml", amount: quantity * 1000 };
  return null;
}

function quantityBasisForEntry(
  quantity: number,
  unit: string,
  snapshot: NutritionSnapshot,
): QuantityBasis | null {
  const direct = quantityInNutritionBasis(quantity, unit);
  if (direct) return direct;

  const normalized = normalizeUnit(unit);
  if (normalized !== "piece" && normalized !== "pack" && normalized !== "pz" && normalized !== "pcs") return null;

  const packageBasis = snapshot.packageQuantityValue != null && snapshot.packageQuantityValue > 0
    ? quantityInNutritionBasis(quantity * snapshot.packageQuantityValue, snapshot.packageQuantityUnit ?? "")
    : null;
  if (packageBasis) return packageBasis;

  return snapshot.servingQuantity != null && snapshot.servingQuantity > 0
    ? quantityInNutritionBasis(quantity * snapshot.servingQuantity, snapshot.servingUnit ?? "")
    : null;
}

export function calculateNutrientsForQuantity(
  quantity: number,
  unit: string,
  snapshot: NutritionSnapshot,
): CalculatedNutrients | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const basis = quantityBasisForEntry(quantity, unit, snapshot);
  if (!basis) return null;

  const per100 = basis.basis === "g"
    ? {
        calories: snapshot.caloriesKcalPer100g,
        protein: snapshot.proteinGPer100g,
        carbs: snapshot.carbsGPer100g,
        fat: snapshot.fatGPer100g,
        fiber: snapshot.fiberGPer100g,
      }
    : {
        calories: snapshot.caloriesKcalPer100ml,
        protein: snapshot.proteinGPer100ml,
        carbs: snapshot.carbsGPer100ml,
        fat: snapshot.fatGPer100ml,
        fiber: snapshot.fiberGPer100ml,
      };
  if (Object.values(per100).every((value) => value === null)) return null;

  const multiplier = basis.amount / 100;
  return {
    calories: (per100.calories ?? 0) * multiplier,
    protein: (per100.protein ?? 0) * multiplier,
    carbs: (per100.carbs ?? 0) * multiplier,
    fat: (per100.fat ?? 0) * multiplier,
    fiber: (per100.fiber ?? 0) * multiplier,
    confidence: per100.calories === null ? "UNKNOWN" : snapshot.confidence,
  };
}

/** Compatibility helper for callers that specifically need a mass quantity. */
export function consumedGramsForQuantity(
  quantity: number,
  unit: string,
  snapshot: NutritionSnapshot,
): number | null {
  const normalized = normalizeUnit(unit);
  if (normalized === "g" || normalized === "gram" || normalized === "grams") return quantity;
  if (normalized === "kg" || normalized === "kilogram" || normalized === "kilograms") return quantity * 1000;
  if (normalized === "mg" || normalized === "milligram" || normalized === "milligrams") return quantity / 1000;
  const package = quantityBasisForEntry(quantity, unit, snapshot);
  return package?.basis === "g" ? package.amount : null;
}
