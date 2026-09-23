export type NutritionConfidence = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";

export interface NutrientTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface ConsumedItem {
  movementId: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  occurredAt: Date;
  nutrients: NutrientTotals;
  confidence: NutritionConfidence;
}

export interface NutritionSummary {
  since: Date;
  totals: NutrientTotals;
  items: ConsumedItem[];
}

export interface NutritionReader {
  /**
   * Every CONSUMPTION movement for the family since `since`, with the product's per-100-base-unit
   * nutrient values already joined in (see migration 0010_nutrition.sql). Products with no
   * nutrition data, or measured in "piece"/"pack" (no defined per-100 basis), come back with
   * `nutritionConfidence: "UNKNOWN"` and zeroed nutrients rather than being silently dropped, so
   * the summary's item count still matches what Dispensa/Movements shows.
   */
  listConsumptionSince(familyId: string, since: Date): Promise<
    {
      movementId: string;
      productId: string;
      productName: string;
      quantity: number;
      unit: string;
      occurredAt: Date;
      caloriesPer100: number | null;
      proteinPer100: number | null;
      carbsPer100: number | null;
      fatPer100: number | null;
      fiberPer100: number | null;
      nutritionConfidence: NutritionConfidence;
    }[]
  >;
}

export class NutritionValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(issues: readonly string[]) {
    super(`Nutrition query is invalid: ${issues.join("; ")}`);
    this.name = "NutritionValidationError";
  }
}

const SCALABLE_UNITS = new Set(["g", "kg", "ml", "l"]);

export class NutritionService {
  private readonly reader: NutritionReader;

  public constructor(reader: NutritionReader) {
    this.reader = reader;
  }

  /**
   * Backs `GET /api/v1/nutrition/summary`. `period` selects how far back to look — "today" (since
   * local midnight UTC) or "week" (rolling 7 days) — matching Nutrienti.tsx's toggle.
   */
  public async getSummary(familyId: string, period: "today" | "week"): Promise<NutritionSummary> {
    if (!familyId.trim()) throw new NutritionValidationError(["familyId is required"]);
    const since = periodStart(period);
    const rows = await this.reader.listConsumptionSince(familyId, since);

    const items: ConsumedItem[] = rows.map((row) => {
      const scalable = SCALABLE_UNITS.has(row.unit) && row.caloriesPer100 !== null;
      const factor = scalable ? row.quantity / 100 : 0;
      return {
        movementId: row.movementId,
        productId: row.productId,
        productName: row.productName,
        quantity: row.quantity,
        unit: row.unit,
        occurredAt: row.occurredAt,
        confidence: scalable ? row.nutritionConfidence : "UNKNOWN",
        nutrients: {
          calories: round((row.caloriesPer100 ?? 0) * factor),
          protein: round((row.proteinPer100 ?? 0) * factor),
          carbs: round((row.carbsPer100 ?? 0) * factor),
          fat: round((row.fatPer100 ?? 0) * factor),
          fiber: round((row.fiberPer100 ?? 0) * factor),
        },
      };
    });

    const totals = items.reduce<NutrientTotals>(
      (acc, item) => ({
        calories: acc.calories + item.nutrients.calories,
        protein: acc.protein + item.nutrients.protein,
        carbs: acc.carbs + item.nutrients.carbs,
        fat: acc.fat + item.nutrients.fat,
        fiber: acc.fiber + item.nutrients.fiber,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    );

    return { since, totals, items };
  }
}

function periodStart(period: "today" | "week"): Date {
  const now = new Date();
  if (period === "today") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return new Date(now.getTime() - 7 * 86_400_000);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
