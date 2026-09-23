import type { NutritionConfidence, NutritionReader } from "./service.js";

export interface SqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface SqlTransaction extends SqlClient {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlTransactionFactory {
  transaction(): Promise<SqlTransaction>;
}

interface ConsumptionRow {
  movement_id: string;
  product_id: string;
  product_name: string;
  quantity: string | number;
  unit: string;
  occurred_at: string;
  calories_per_100: string | number | null;
  protein_per_100: string | number | null;
  carbs_per_100: string | number | null;
  fat_per_100: string | number | null;
  fiber_per_100: string | number | null;
  nutrition_confidence: NutritionConfidence;
}

export class PostgresNutritionReader implements NutritionReader {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async listConsumptionSince(familyId: string, since: Date) {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<ConsumptionRow>(
        `SELECT m.id AS movement_id, p.id AS product_id, p.canonical_name AS product_name,
            m.quantity, m.unit, m.occurred_at,
            p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100,
            p.nutrition_confidence
         FROM stock_movements m
         JOIN stock_items s ON s.id = m.stock_item_id
         JOIN products p ON p.id = s.product_id
         WHERE m.family_id = $1 AND m.kind = 'CONSUMPTION' AND m.occurred_at >= $2
         ORDER BY m.occurred_at DESC
         LIMIT 200`,
        [familyId, since],
      );
      await transaction.commit();
      return result.rows.map((row) => ({
        movementId: row.movement_id,
        productId: row.product_id,
        productName: row.product_name,
        quantity: numberValue(row.quantity),
        unit: row.unit,
        occurredAt: new Date(row.occurred_at),
        caloriesPer100: nullableNumber(row.calories_per_100),
        proteinPer100: nullableNumber(row.protein_per_100),
        carbsPer100: nullableNumber(row.carbs_per_100),
        fatPer100: nullableNumber(row.fat_per_100),
        fiberPer100: nullableNumber(row.fiber_per_100),
        nutritionConfidence: row.nutrition_confidence,
      }));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function numberValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Database returned an invalid numeric value.");
  return parsed;
}

function nullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return numberValue(value);
}
