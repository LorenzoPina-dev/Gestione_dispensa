import type { Request } from "express";

export interface NutritionSnapshot {
  caloriesKcalPer100g: number | null;
  proteinGPer100g: number | null;
  carbsGPer100g: number | null;
  fatGPer100g: number | null;
  fiberGPer100g: number | null;
  source: string;
  sourceProductVersion: number | null;
}

export async function loadNutritionSnapshot(
  baseUrl: string,
  authorization: string | undefined,
  productId: string,
): Promise<NutritionSnapshot | null> {
  const url = new URL("/catalog/products/" + encodeURIComponent(productId), baseUrl.replace(/\/$/, "") + "/");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;
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
  } };
  const data = body.data;
  if (!data) return null;
  return {
    caloriesKcalPer100g: data.nutrition?.kcalPer100g ?? null,
    proteinGPer100g: data.nutrition?.proteinGPer100g ?? null,
    carbsGPer100g: data.nutrition?.carbsGPer100g ?? null,
    fatGPer100g: data.nutrition?.fatGPer100g ?? null,
    fiberGPer100g: data.nutrition?.fiberGPer100g ?? null,
    source: data.source?.type ?? "unknown",
    sourceProductVersion: typeof data.version === "number" ? data.version : null,
  };
}

export function nutrientMultiplier(quantity: number, unit: string): number {
  if (unit === "g") return quantity / 100;
  if (unit === "kg") return (quantity * 1000) / 100;
  throw new Error("Nutrition diary entries require unit g or kg.");
}
