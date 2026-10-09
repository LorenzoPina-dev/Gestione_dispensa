/**
 * Runtime extensions to the shopping journey (WEB-SHP-001): batch accept/reject, completion to
 * inventory, list sharing attribution, archive with retained history, and in-app shopping
 * notifications. Every mutation keeps the same explicit conflict/offline/retryable recovery
 * vocabulary as the rest of the web runtime.
 */

export type ShoppingBatchAction = "ACCEPT" | "REJECT";
export type ShoppingBatchState =
  | "SUBMITTING"
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "CONFLICT"
  | "RETRYABLE_ERROR"
  | "OFFLINE";

export interface ShoppingBatchModel {
  readonly state: ShoppingBatchState;
  readonly action: ShoppingBatchAction;
  readonly itemIds: readonly string[];
  readonly failedItemIds: readonly string[];
  readonly listVersion: number;
  readonly message: string;
}

export function beginShoppingBatchAction(
  action: ShoppingBatchAction,
  itemIds: readonly string[],
  listVersion: number,
): ShoppingBatchModel {
  const uniqueIds = dedupeIds(itemIds);
  if (uniqueIds.length === 0) {
    return {
      state: "RETRYABLE_ERROR",
      action,
      itemIds: uniqueIds,
      failedItemIds: [],
      listVersion,
      message: "Select at least one item.",
    };
  }
  if (!Number.isInteger(listVersion) || listVersion < 0) {
    return {
      state: "RETRYABLE_ERROR",
      action,
      itemIds: uniqueIds,
      failedItemIds: uniqueIds,
      listVersion,
      message: "The shopping list version is invalid.",
    };
  }
  return {
    state: "SUBMITTING",
    action,
    itemIds: uniqueIds,
    failedItemIds: [],
    listVersion,
    message: `Saving ${uniqueIds.length} item${uniqueIds.length === 1 ? "" : "s"}.`,
  };
}

export type ShoppingBatchOutcome =
  | { readonly outcome: "SUCCESS" }
  | { readonly outcome: "PARTIAL_SUCCESS"; readonly failedItemIds: readonly string[] }
  | { readonly outcome: "CONFLICT" }
  | { readonly outcome: "RETRYABLE_ERROR" }
  | { readonly outcome: "OFFLINE" };

export function resolveShoppingBatchResult(
  model: ShoppingBatchModel,
  result: ShoppingBatchOutcome,
): ShoppingBatchModel {
  if (result.outcome === "SUCCESS") {
    return { ...model, state: "SUCCESS", failedItemIds: [], message: batchSuccessMessage(model) };
  }
  if (result.outcome === "PARTIAL_SUCCESS") {
    const failedItemIds = result.failedItemIds.filter((id) => model.itemIds.includes(id));
    return {
      ...model,
      state: "PARTIAL_SUCCESS",
      failedItemIds,
      message: `${model.itemIds.length - failedItemIds.length} of ${model.itemIds.length} items saved. Review the rest.`,
    };
  }
  const messages: Record<"CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE", string> = {
    CONFLICT: "The list changed elsewhere. Review before retrying.",
    RETRYABLE_ERROR: "The batch action can be retried.",
    OFFLINE: "You are offline. The batch action will retry when connected.",
  };
  return {
    ...model,
    state: result.outcome,
    failedItemIds: model.itemIds,
    message: messages[result.outcome],
  };
}

function batchSuccessMessage(model: ShoppingBatchModel): string {
  const verb = model.action === "ACCEPT" ? "accepted" : "rejected";
  return `${model.itemIds.length} item${model.itemIds.length === 1 ? "" : "s"} ${verb}.`;
}

function dedupeIds(itemIds: readonly string[]): readonly string[] {
  const trimmed = itemIds.map((id) => id.trim()).filter((id) => id.length > 0);
  return [...new Set(trimmed)];
}

// --- Completion to stock ---------------------------------------------------

export type CompletionToStockState =
  | "READY"
  | "SUBMITTING"
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "CONFLICT"
  | "RETRYABLE_ERROR"
  | "OFFLINE";

export interface CompletedShoppingItem {
  readonly itemId: string;
  readonly productId?: string;
  readonly displayName: string;
  readonly quantity: number;
}

export interface CompletionToStockCandidate extends CompletedShoppingItem {
  readonly confirmedQuantity: number;
}

export interface CompletionToStockModel {
  readonly state: CompletionToStockState;
  readonly listId: string;
  readonly candidates: readonly CompletionToStockCandidate[];
  readonly failedItemIds: readonly string[];
  readonly message: string;
}

export function beginCompletionToStock(input: {
  readonly listId: string;
  readonly completedItems: readonly CompletedShoppingItem[];
}): CompletionToStockModel {
  if (input.listId.trim() === "") {
    return {
      state: "RETRYABLE_ERROR",
      listId: input.listId,
      candidates: [],
      failedItemIds: [],
      message: "The shopping list is unavailable.",
    };
  }
  const candidates = input.completedItems
    .filter((item) => item.itemId.trim() !== "" && item.quantity > 0)
    .map((item) => ({ ...item, confirmedQuantity: item.quantity }));
  return {
    state: "READY",
    listId: input.listId,
    candidates,
    failedItemIds: [],
    message:
      candidates.length === 0
        ? "No completed items to load into inventory."
        : "Confirm quantities before loading purchased items into inventory.",
  };
}

export function confirmCompletionQuantity(
  model: CompletionToStockModel,
  itemId: string,
  confirmedQuantity: number,
): CompletionToStockModel {
  if (!Number.isFinite(confirmedQuantity) || confirmedQuantity <= 0) return model;
  return {
    ...model,
    candidates: model.candidates.map((candidate) =>
      candidate.itemId === itemId ? { ...candidate, confirmedQuantity } : candidate,
    ),
  };
}

export function submitCompletionToStock(model: CompletionToStockModel): CompletionToStockModel {
  if (model.candidates.length === 0) {
    return {
      ...model,
      state: "RETRYABLE_ERROR",
      message: "There are no confirmed items to load into inventory.",
    };
  }
  return {
    ...model,
    state: "SUBMITTING",
    message: `Loading ${model.candidates.length} item${model.candidates.length === 1 ? "" : "s"} into inventory.`,
  };
}

export function resolveCompletionToStock(
  model: CompletionToStockModel,
  result: ShoppingBatchOutcome,
): CompletionToStockModel {
  if (result.outcome === "SUCCESS") {
    return {
      ...model,
      state: "SUCCESS",
      failedItemIds: [],
      message: "Purchased items were loaded into inventory.",
    };
  }
  if (result.outcome === "PARTIAL_SUCCESS") {
    const failedItemIds = result.failedItemIds.filter((id) =>
      model.candidates.some((candidate) => candidate.itemId === id),
    );
    return {
      ...model,
      state: "PARTIAL_SUCCESS",
      failedItemIds,
      message: `${model.candidates.length - failedItemIds.length} of ${model.candidates.length} items loaded. Review the rest.`,
    };
  }
  const messages: Record<"CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE", string> = {
    CONFLICT: "Inventory changed elsewhere. Review before retrying.",
    RETRYABLE_ERROR: "Loading purchased items can be retried.",
    OFFLINE: "You are offline. Loading purchased items will retry when connected.",
  };
  return {
    ...model,
    state: result.outcome,
    failedItemIds: model.candidates.map((candidate) => candidate.itemId),
    message: messages[result.outcome],
  };
}

// --- Sharing -----------------------------------------------------------------

export interface ShoppingListActivity {
  readonly listId: string;
  readonly lastEditedByUserId?: string;
  readonly lastEditedByDisplayName?: string;
  readonly lastEditedAt?: string;
  readonly sharedWithCount: number;
}

export function describeListActivity(
  activity: ShoppingListActivity,
  viewerUserId: string,
): string {
  if (activity.lastEditedByUserId === undefined) {
    return activity.sharedWithCount > 0
      ? `Shared with ${activity.sharedWithCount} family member${activity.sharedWithCount === 1 ? "" : "s"}. No changes yet.`
      : "No recent changes.";
  }
  if (activity.lastEditedByUserId === viewerUserId) return "You made the last change.";
  const editor = activity.lastEditedByDisplayName ?? "A family member";
  return `${editor} made the last change.`;
}

// --- Archive -------------------------------------------------------------

export type ShoppingArchiveState =
  | "ARCHIVING"
  | "ARCHIVED"
  | "CONFLICT"
  | "RETRYABLE_ERROR"
  | "OFFLINE";

export interface ShoppingArchiveModel {
  readonly state: ShoppingArchiveState;
  readonly listId: string;
  readonly listVersion: number;
  readonly message: string;
}

export function beginArchiveList(listId: string, listVersion: number): ShoppingArchiveModel {
  if (listId.trim() === "" || !Number.isInteger(listVersion) || listVersion < 0) {
    return {
      state: "RETRYABLE_ERROR",
      listId,
      listVersion,
      message: "The shopping list is unavailable.",
    };
  }
  return {
    state: "ARCHIVING",
    listId,
    listVersion,
    message: "Archiving the shopping list. History will remain available.",
  };
}

export function resolveArchiveResult(
  model: ShoppingArchiveModel,
  result: "SUCCESS" | "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE",
): ShoppingArchiveModel {
  const messages: Record<"SUCCESS" | "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE", string> = {
    SUCCESS: "Shopping list archived. History remains available.",
    CONFLICT: "The list changed elsewhere. Review before archiving.",
    RETRYABLE_ERROR: "Archiving can be retried.",
    OFFLINE: "You are offline. Archiving will retry when connected.",
  };
  return {
    ...model,
    state: result === "SUCCESS" ? "ARCHIVED" : result,
    message: messages[result],
  };
}

// --- Notifications ---------------------------------------------------------

export type ShoppingNotificationCategory =
  | "LIST_SHARED"
  | "ITEM_ADDED"
  | "LIST_ARCHIVED"
  | "REORDER_SUGGESTED";

export interface ShoppingNotification {
  readonly id: string;
  readonly category: ShoppingNotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly readAt?: string;
}

export function unreadShoppingNotificationCount(
  notifications: readonly ShoppingNotification[],
): number {
  return notifications.filter((notification) => notification.readAt === undefined).length;
}

export function markShoppingNotificationRead(
  notifications: readonly ShoppingNotification[],
  notificationId: string,
  now: string,
): readonly ShoppingNotification[] {
  return notifications.map((notification) =>
    notification.id === notificationId ? { ...notification, readAt: now } : notification,
  );
}
