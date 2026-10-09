import type { ProductDto } from "../../api/types";
import type { StockItem } from "../../types";

export type Candidate = {
  productId: string;
  name: string;
  brand?: string;
  unit: StockItem["unit"];
  category?: string;
  photoUrl?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  quantityValue?: number;
  quantityUnit?: string;
  quantityLabel?: string;
  servingSize?: string;
  servingQuantity?: number;
  servingUnit?: string;
  images?: {
    front?: string;
    frontSmall?: string;
    frontThumb?: string;
    ingredients?: string;
    ingredientsSmall?: string;
    ingredientsThumb?: string;
    nutrition?: string;
    nutritionSmall?: string;
    nutritionThumb?: string;
    packaging?: string;
    packagingSmall?: string;
    packagingThumb?: string;
  };
  openFoodFacts?: Record<string, unknown>;
  provenanceQuality: "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
};

export function candidateFromProduct(p: ProductDto): Candidate {
  return {
    productId: p.id,
    name: p.canonicalName || `Prodotto ${p.id?.slice(0, 8) || ""}`,
    brand: p.brand,
    unit: (p.defaultUnit || p.quantityUnit || "piece") as StockItem["unit"],
    category: p.category,
    photoUrl: p.photoUrl,
    calories: p.calories,
    protein: p.protein,
    carbs: p.carbs,
    fat: p.fat,
    fiber: p.fiber,
    quantityValue: p.quantityValue,
    quantityUnit: p.quantityUnit,
    quantityLabel: p.quantityLabel,
    servingSize: p.servingSize,
    servingQuantity: p.servingQuantity,
    servingUnit: p.servingUnit,
    images: p.images,
    openFoodFacts: p.openFoodFacts,
    provenanceQuality: p.provenanceQuality,
  };
}

export function defaultPackageCount(_candidate: Candidate): string {
  return "1";
}

export function normalizePackageUnit(value: string | undefined): StockItem["unit"] | null {
  const unit = String(value ?? "").trim().toLowerCase();
  if (unit === "g" || unit === "kg" || unit === "ml" || unit === "l" || unit === "piece" || unit === "pack") {
    return unit;
  }
  return null;
}

export function packageCountToStock(
  candidate: Candidate,
  packageCount: number,
): { quantity: number; unit: StockItem["unit"] } {
  const packageUnit = normalizePackageUnit(candidate.quantityUnit);

  if (
    candidate.quantityValue != null &&
    Number.isFinite(candidate.quantityValue) &&
    candidate.quantityValue > 0 &&
    packageUnit !== null
  ) {
    return {
      quantity: Math.round(candidate.quantityValue * packageCount * 1000) / 1000,
      unit: packageUnit,
    };
  }

  // Nessuna pezzatura affidabile: non inventiamo grammi/ml. Conserviamo esplicitamente
  // il numero di confezioni e lasciamo al catalogo/nutrizione il valore come non convertibile.
  return {
    quantity: packageCount,
    unit: "pack",
  };
}
