export type InventoryAction = "RECEIPT" | "CONSUMPTION" | "WASTE" | "ADJUSTMENT";
export type InventoryActionState =
  "IDLE" | "SUBMITTING" | "SUCCESS" | "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE";

export interface InventoryJourneyModel {
  readonly state: InventoryActionState;
  readonly action: InventoryAction;
  readonly message: string;
  readonly version?: number;
}

export function beginInventoryAction(
  action: InventoryAction,
  version: number,
): InventoryJourneyModel {
  if (!Number.isInteger(version) || version < 0) {
    return { state: "RETRYABLE_ERROR", action, message: "The stock version is invalid." };
  }
  return { state: "SUBMITTING", action, message: "Saving stock movement.", version };
}

export function resolveInventoryResult(
  model: InventoryJourneyModel,
  result: "SUCCESS" | "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE",
): InventoryJourneyModel {
  const messages = {
    SUCCESS: "Stock updated.",
    CONFLICT: "Stock changed elsewhere. Review before retrying.",
    RETRYABLE_ERROR: "The stock update can be retried.",
    OFFLINE: "You are offline. The update will retry when connected.",
  } as const;
  return { ...model, state: result, message: messages[result] };
}
