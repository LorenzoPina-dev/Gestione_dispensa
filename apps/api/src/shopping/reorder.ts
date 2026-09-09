import type { InventoryUnit, StockItem } from "../inventory/service.js";

export interface ReorderSuggestion {
  dedupeKey: string;
  familyId: string;
  stockItemId: string;
  productId: string;
  availableQuantity: number;
  reorderPoint: number;
  unit: InventoryUnit;
  reason: "THRESHOLD_REACHED";
  state: "SUGGESTED";
}

export interface ExistingSuggestion {
  dedupeKey: string;
  state: "SUGGESTED" | "ACCEPTED" | "SNOOZED" | "IGNORED" | "COMPLETED";
}

export interface ReorderRepository {
  findByDedupeKey(dedupeKey: string): Promise<ExistingSuggestion | undefined>;
  upsertReorderSuggestion(
    suggestion: ReorderSuggestion,
  ): Promise<{ suggestion: ReorderSuggestion; created: boolean }>;
}

export interface ReorderEvent {
  eventType: "inventory.reorder-point-reached";
  eventVersion: 1;
  familyId: string;
  aggregateId: string;
  dedupeKey: string;
  payload: {
    productId: string;
    stockItemId: string;
    availableQuantity: number;
    reorderPoint: number;
    reason: "THRESHOLD_REACHED";
    dedupeKey: string;
  };
}

export class ReorderPolicy {
  public evaluate(stock: StockItem): ReorderSuggestion | undefined {
    if (stock.reorderPoint === undefined || stock.quantity > stock.reorderPoint) return undefined;
    return {
      dedupeKey: `${stock.familyId}:${stock.id}:reorder:${stock.version}`,
      familyId: stock.familyId,
      stockItemId: stock.id,
      productId: stock.productId,
      availableQuantity: stock.quantity,
      reorderPoint: stock.reorderPoint,
      unit: stock.unit,
      reason: "THRESHOLD_REACHED",
      state: "SUGGESTED",
    };
  }
}

export class ReorderService {
  private readonly policy: ReorderPolicy;
  private readonly repository: ReorderRepository;

  public constructor(repository: ReorderRepository, policy = new ReorderPolicy()) {
    this.repository = repository;
    this.policy = policy;
  }

  public async evaluate(
    stock: StockItem,
  ): Promise<{ suggestion: ReorderSuggestion; created: boolean } | undefined> {
    const suggestion = this.policy.evaluate(stock);
    if (suggestion === undefined) return undefined;
    const existing = await this.repository.findByDedupeKey(suggestion.dedupeKey);
    if (
      existing?.state === "IGNORED" ||
      existing?.state === "SNOOZED" ||
      existing?.state === "COMPLETED"
    )
      return undefined;
    return this.repository.upsertReorderSuggestion(suggestion);
  }

  public eventFor(suggestion: ReorderSuggestion): ReorderEvent {
    return {
      eventType: "inventory.reorder-point-reached",
      eventVersion: 1,
      familyId: suggestion.familyId,
      aggregateId: suggestion.stockItemId,
      dedupeKey: suggestion.dedupeKey,
      payload: {
        productId: suggestion.productId,
        stockItemId: suggestion.stockItemId,
        availableQuantity: suggestion.availableQuantity,
        reorderPoint: suggestion.reorderPoint,
        reason: suggestion.reason,
        dedupeKey: suggestion.dedupeKey,
      },
    };
  }
}
