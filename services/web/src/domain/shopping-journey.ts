export type ShoppingAction = "ACCEPT" | "REJECT" | "SNOOZE" | "COMPLETE" | "EDIT";
export type ShoppingState =
  "IDLE" | "SUBMITTING" | "SUCCESS" | "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE";

export interface ShoppingJourneyModel {
  readonly state: ShoppingState;
  readonly action: ShoppingAction;
  readonly listVersion: number;
  readonly message: string;
}

export function beginShoppingAction(
  action: ShoppingAction,
  listVersion: number,
): ShoppingJourneyModel {
  if (!Number.isInteger(listVersion) || listVersion < 0) {
    return {
      state: "RETRYABLE_ERROR",
      action,
      listVersion,
      message: "The shopping list version is invalid.",
    };
  }
  return { state: "SUBMITTING", action, listVersion, message: "Saving shopping list changes." };
}

export function resolveShoppingResult(
  model: ShoppingJourneyModel,
  result: "SUCCESS" | "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE",
): ShoppingJourneyModel {
  const messages = {
    SUCCESS: "Shopping list updated.",
    CONFLICT: "The list changed elsewhere. Review before retrying.",
    RETRYABLE_ERROR: "The list update can be retried.",
    OFFLINE: "You are offline. The update will retry when connected.",
  } as const;
  return { ...model, state: result, message: messages[result] };
}
