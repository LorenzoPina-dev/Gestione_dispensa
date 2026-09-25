export type StorageKind = "PANTRY" | "FRIDGE" | "FREEZER" | "CELLAR" | "OTHER";

/** Sentinel category used for products with no (or an unrecognized) category. */
export const DEFAULT_CATEGORY = "__default__";

export interface ShelfLifeRule {
  category: string;
  storageKind: StorageKind;
  /** undefined means "non-perishable here": no expiry is estimated, no notification is raised. */
  estimatedDays: number | undefined;
  notifyDaysBefore: number;
}

/**
 * Backs the three sourcing channels described for this feature:
 *  1. Open Food Facts category mapping (see worker-integrations' open-food-facts-provider.ts,
 *     which normalizes OFF's categories_tags into this same canonical vocabulary).
 *  2. USDA FoodKeeper / EFSA reference tables (seeded into shelf_life_rules by
 *     0014_shelf-life.sql, see PostgresShelfLifeRuleRepository).
 *  3. An LLM fallback for the long tail is expected to write its guess onto products.category
 *     (as an ESTIMATED-quality product, the same way an Open Food Facts match is persisted --
 *     see catalog/workflow.ts) rather than bypass this table, so a second scan of the same
 *     product never needs to call the LLM again.
 */
export interface ShelfLifeRuleRepository {
  findRule(category: string | undefined, storageKind: StorageKind): Promise<ShelfLifeRule | undefined>;
}

export interface ShelfLifeEstimate {
  expiresAt: Date | undefined;
  notifyDaysBefore: number;
}

export class ShelfLifeEstimationService {
  private readonly rules: ShelfLifeRuleRepository;

  public constructor(rules: ShelfLifeRuleRepository) {
    this.rules = rules;
  }

  /**
   * Resolves a rule for `category` at `storageKind`, falling back to the DEFAULT_CATEGORY rule
   * for that storage kind when the product has no category or none of our rules recognize it.
   * Never throws: an entirely unconfigured shelf_life_rules table (e.g. a fresh local install
   * whose migrations haven't run yet) simply yields "no estimate", the same degrade-gracefully
   * posture as CatalogWorkflowService.resolveBarcode.
   */
  public async estimate(input: {
    category: string | undefined;
    storageKind: StorageKind;
    receivedAt: Date;
  }): Promise<ShelfLifeEstimate> {
    const rule = await this.resolveRule(input.category, input.storageKind);
    if (rule === undefined || rule.estimatedDays === undefined) {
      return { expiresAt: undefined, notifyDaysBefore: rule?.notifyDaysBefore ?? 2 };
    }
    const expiresAt = new Date(input.receivedAt);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + rule.estimatedDays);
    return { expiresAt, notifyDaysBefore: rule.notifyDaysBefore };
  }

  /** Used by the expiry scan to know how many days ahead of `expiresAt` to warn a family. */
  public async notifyDaysBefore(input: {
    category: string | undefined;
    storageKind: StorageKind;
  }): Promise<number> {
    const rule = await this.resolveRule(input.category, input.storageKind);
    return rule?.notifyDaysBefore ?? 2;
  }

  private async resolveRule(
    category: string | undefined,
    storageKind: StorageKind,
  ): Promise<ShelfLifeRule | undefined> {
    const normalized = category?.trim().toLowerCase();
    if (normalized) {
      const specific = await this.rules.findRule(normalized, storageKind);
      if (specific !== undefined) return specific;
    }
    return this.rules.findRule(DEFAULT_CATEGORY, storageKind);
  }
}

/** Free-text location kinds (as typed by a person or an OCR pipeline) -> our storage vocabulary. */
export function normalizeStorageKind(value: string | undefined | null): StorageKind {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "frigo" || normalized === "fridge" || normalized === "frigorifero") return "FRIDGE";
  if (normalized === "freezer" || normalized === "congelatore") return "FREEZER";
  if (normalized === "dispensa" || normalized === "pantry") return "PANTRY";
  if (normalized === "cantina" || normalized === "cellar") return "CELLAR";
  return "OTHER";
}
