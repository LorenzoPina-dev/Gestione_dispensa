import type { Request } from "express";

export type NutritionConfidence = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";

export interface NutritionSnapshot {
  productName: string;
  brand: string | null;
  caloriesKcalPer100g: number | null;
  proteinGPer100g: number | null;
  carbsGPer100g: number | null;
  fatGPer100g: number | null;
  fiberGPer100g: number | null;
  source: string;
  sourceProductVersion: number | null;
  confidence: NutritionConfidence;
  packageQuantityValue: number | null;
  packageQuantityUnit: string | null;
}

export async function loadNutritionSnapshot(
  baseUrl: string,
  authorization: string | undefined,
  productId: string,
  internalToken?: string,
): Promise<NutritionSnapshot | null> {
  const path = internalToken ? "catalog/internal/products/" + encodeURIComponent(productId) : "catalog/products/" + encodeURIComponent(productId);
  const url = new URL(path, baseUrl.replace(/\/$/, "") + "/");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;
  if (internalToken) headers["x-internal-service-token"] = internalToken;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(2500) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Catalog nutrition lookup failed with HTTP " + response.status);
  const body = await response.json() as { data?: {
    nutrition?: {
      kcalPer100g?: number | null;
      proteinGPer100g?: number | null;
      carbsGPer100g?: number | null;
      fatGPer100g?: number | null;
      fiberGPer100g?: number | null;
    };
    source?: { type?: string };
    version?: number;
    name?: string;
    brand?: string | null;
    package?: { value?: number | null; unit?: string | null };
  } };
  const data = body.data;
  if (!data) return null;
  const source = data.source?.type ?? "unknown";
  const nutrition = data.nutrition;
  const hasNutrition = [
    nutrition?.kcalPer100g,
    nutrition?.proteinGPer100g,
    nutrition?.carbsGPer100g,
    nutrition?.fatGPer100g,
    nutrition?.fiberGPer100g,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
  const confidence: NutritionConfidence =
    !hasNutrition ? "UNKNOWN" : source === "manual" ? "CONFIRMED" : "ESTIMATED";
  return {
    productName: typeof data.name === "string" && data.name.trim() ? data.name.trim() : productId,
    brand: typeof data.brand === "string" && data.brand.trim() ? data.brand.trim() : null,
    caloriesKcalPer100g: nutrition?.kcalPer100g ?? null,
    proteinGPer100g: nutrition?.proteinGPer100g ?? null,
    carbsGPer100g: nutrition?.carbsGPer100g ?? null,
    fatGPer100g: nutrition?.fatGPer100g ?? null,
    fiberGPer100g: nutrition?.fiberGPer100g ?? null,
    source,
    sourceProductVersion: typeof data.version === "number" ? data.version : null,
    confidence,
    packageQuantityValue: typeof data.package?.value === "number" ? data.package.value : null,
    packageQuantityUnit: typeof data.package?.unit === "string" ? data.package.unit : null,
  };
}

export function nutrientMultiplier(quantity: number, unit: string): number {
  if (unit === "g") return quantity / 100;
  if (unit === "kg") return (quantity * 1000) / 100;
  throw new Error("Nutrition diary entries require unit g or kg.");
}


export function consumedGramsForQuantity(
  quantity: number,
  unit: string,
  snapshot: NutritionSnapshot,
): number | null {
  const normalizedUnit = unit.trim().toLowerCase();
  if (normalizedUnit === "g") return quantity;
  if (normalizedUnit === "kg") return quantity * 1000;

  if ((normalizedUnit === "piece" || normalizedUnit === "pack") &&
      snapshot.packageQuantityValue != null) {
    const packageUnit = snapshot.packageQuantityUnit?.trim().toLowerCase();
    if (packageUnit === "g") return quantity * snapshot.packageQuantityValue;
    if (packageUnit === "kg") return quantity * snapshot.packageQuantityValue * 1000;
  }

  // ml/l cannot be converted to grams without a density value. Do not fabricate it.
  return null;
}
