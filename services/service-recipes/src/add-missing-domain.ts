export type UnitFamily = "mass" | "volume" | "count";

export type UnitInfo = {
  family: UnitFamily;
  factor: number;
};

export type MissingIngredient = {
  productId?: string | null;
  name: string;
  quantity: number;
  unit: string;
};

export type StockItem = {
  productId?: string;
  quantity?: number;
  unit?: string;
};

export type MissingNeed = {
  ingredient: MissingIngredient;
  quantity: number;
  index: number;
};

export function unitInfo(unit: string): UnitInfo | null {
  switch (unit.toLowerCase()) {
    case "kg": return { family: "mass", factor: 1000 };
    case "g": return { family: "mass", factor: 1 };
    case "l": return { family: "volume", factor: 1000 };
    case "ml": return { family: "volume", factor: 1 };
    case "piece": return { family: "count", factor: 1 };
    case "pack": return { family: "count", factor: 1 };
    default: return null;
  }
}

export function calculateMissingIngredients(
  ingredients: MissingIngredient[],
  stock: StockItem[],
): MissingNeed[] {
  const needs: MissingNeed[] = [];

  ingredients.forEach((ingredient, index) => {
    const target = unitInfo(ingredient.unit);
    if (!target || ingredient.quantity <= 0) return;

    let availableBase = 0;
    if (ingredient.productId) {
      for (const item of stock) {
        if (String(item.productId ?? "") !== String(ingredient.productId)) continue;
        const source = unitInfo(String(item.unit ?? ""));
        if (!source || source.family !== target.family) continue;
        availableBase += Number(item.quantity ?? 0) * source.factor;
      }
    }

    const deficitBase = Math.max(0, ingredient.quantity * target.factor - availableBase);
    if (deficitBase > 0) {
      needs.push({
        ingredient,
        quantity: Number((deficitBase / target.factor).toFixed(3)),
        index,
      });
    }
  });

  return needs;
}
