import { useCallback, useEffect, useRef, useState } from "react";
import type { ShoppingList, ShoppingItemState as UiItemState } from "../types";
import { shoppingList as mockShoppingList } from "../mockData";
import * as api from "../api/endpoints";
import { ApiError, isBackendUnreachable, isNotFound } from "../api/client";
import { FAMILY_ID as DEFAULT_FAMILY_ID } from "../api/config";
import { mapActiveShoppingListDtoToUi } from "../api/mappers";
import { reportSyncIssue } from "../lib/syncBus";
import {
  beginShoppingAction,
  resolveShoppingResult,
  type ShoppingAction,
} from "../domain/shopping-journey";
import {
  beginShoppingBatchAction,
  resolveShoppingBatchResult,
} from "../domain/shopping-workflow";

export type SetShoppingList = React.Dispatch<React.SetStateAction<ShoppingList>>;

export interface UseShoppingListResult {
  list: ShoppingList;
  setList: SetShoppingList;
  isDemo: boolean;
  loading: boolean;
  demoReason: string | null;
}

/**
 * Loads `GET /api/v1/shopping/lists/active?familyId=...` and keeps it in sync the same way
 * `useInventory` does: pages call `setList(updater)` exactly like React state, and this hook
 * diffs the before/after lists to work out which endpoint to call — add item, a single item's
 * state change (`PATCH .../items/{id}`, with the item's `version` as `If-Match`), or a
 * batch-action when several items change to the same state at once (Spesa.tsx's "accetta
 * selezionati").
 *
 * @param familyId See the matching parameter on `useInventory`.
 */
export function useShoppingList(familyId?: string | null): UseShoppingListResult {
  const effectiveFamilyId = familyId ?? DEFAULT_FAMILY_ID ?? null;
  const [list, setListState] = useState<ShoppingList>(mockShoppingList);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;
  const familyIdRef = useRef(effectiveFamilyId);
  familyIdRef.current = effectiveFamilyId;

  useEffect(() => {
    if (!effectiveFamilyId) {
      setListState(mockShoppingList);
      setIsDemo(true);
      setDemoReason("Nessuna famiglia attiva");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const dto = await api.getActiveShoppingList(effectiveFamilyId);
        if (cancelled) return;
        setListState(mapActiveShoppingListDtoToUi(dto));
        setIsDemo(false);
        setDemoReason(null);
      } catch (err) {
        if (isNotFound(err)) {
          // No active list yet for this family — legitimate empty state, not a failure. Create
          // one so the UI has a real (non-demo) list to add items to.
          try {
            const created = await api.createShoppingList(effectiveFamilyId, "Spesa settimanale");
            if (cancelled) return;
            setListState({ id: created.id, name: created.name, status: created.status, version: created.version, items: [] });
            setIsDemo(false);
            setDemoReason(null);
          } catch (createErr) {
            if (cancelled) return;
            setListState(mockShoppingList);
            setIsDemo(true);
            setDemoReason(describeError(createErr));
          }
        } else {
          if (cancelled) return;
          setListState(mockShoppingList);
          setIsDemo(true);
          setDemoReason(describeError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFamilyId]);

  const setList = useCallback<SetShoppingList>((updater) => {
    setListState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: ShoppingList) => ShoppingList)(prev) : updater;
      if (!isDemoRef.current && familyIdRef.current) void syncShoppingDiff(familyIdRef.current, prev, next);
      return next;
    });
  }, []);

  return { list, setList, isDemo, loading, demoReason };
}

async function syncShoppingDiff(familyId: string, prev: ShoppingList, next: ShoppingList): Promise<void> {
  const listId = next.id;
  const prevById = new Map(prev.items.map((item) => [item.id, item]));
  const nextById = new Map(next.items.map((item) => [item.id, item]));

  const created = next.items.filter((item) => !prevById.has(item.id));
  for (const item of created) {
    const input = { displayName: item.displayName, quantity: item.quantity, unit: item.unit, sourceType: item.sourceType };
    await api
      .addShoppingItem(familyId, listId, input)
      .catch((err) =>
        reportIssue(
          "shopping",
          `Aggiunta di "${item.displayName}" non salvata sul server.`,
          err,
          () => api.addShoppingItem(familyId, listId, input).then(() => undefined),
        ),
      );
  }

  const changed: { id: string; from: UiItemState; to: UiItemState; version: number }[] = [];
  for (const item of next.items) {
    const before = prevById.get(item.id);
    if (before && before.state !== item.state) {
      changed.push({ id: item.id, from: before.state, to: item.state, version: before.version });
    }
  }

  if (changed.length > 1) {
    const targetState = changed[0].to;
    const allSameTarget = changed.every((c) => c.to === targetState);
    if (allSameTarget) {
      await syncBatch(familyId, listId, changed.map((c) => c.id), targetState, next.version);
    } else {
      for (const c of changed) await syncSingle(familyId, listId, c.id, c.to, c.version);
    }
  } else if (changed.length === 1) {
    const [c] = changed;
    await syncSingle(familyId, listId, c.id, c.to, c.version);
  }

  for (const item of prev.items) {
    if (!nextById.has(item.id)) {
      // Removed client-side only (no delete-item endpoint documented); treat as IGNORED.
      await syncSingle(familyId, listId, item.id, "IGNORED", item.version);
    }
  }
}

async function syncSingle(
  familyId: string,
  listId: string,
  itemId: string,
  state: UiItemState,
  version: number,
): Promise<void> {
  const action: ShoppingAction =
    state === "ACCEPTED" ? "ACCEPT" : state === "SNOOZED" ? "SNOOZE" : state === "IGNORED" ? "REJECT" : "EDIT";
  let journey = beginShoppingAction(action, version);
  try {
    await api.updateShoppingItemState(familyId, listId, itemId, version, state);
    journey = resolveShoppingResult(journey, "SUCCESS");
  } catch (err) {
    journey = resolveShoppingResult(journey, classifyOutcome(err));
    reportIssue(
      "shopping",
      "Modifica di un articolo della spesa non salvata sul server.",
      err,
      () => api.updateShoppingItemState(familyId, listId, itemId, version, state).then(() => undefined),
    );
  } finally {
    console.debug(`[shopping] ${journey.action}: ${journey.message}`);
  }
}

async function syncBatch(
  familyId: string,
  listId: string,
  itemIds: string[],
  state: UiItemState,
  listVersion: number,
): Promise<void> {
  const action = state === "ACCEPTED" ? "ACCEPT" : "REJECT";
  let batch = beginShoppingBatchAction(action, itemIds, listVersion);
  try {
    const result = await api.batchUpdateShoppingItems(familyId, listId, itemIds, state);
    batch = resolveShoppingBatchResult(
      batch,
      result.failedItemIds.length === 0
        ? { outcome: "SUCCESS" }
        : { outcome: "PARTIAL_SUCCESS", failedItemIds: result.failedItemIds },
    );
    if (result.failedItemIds.length > 0) {
      reportSyncIssue({
        domain: "shopping",
        message: `${result.failedItemIds.length} articoli non aggiornati sul server.`,
        retryable: true,
        retry: () => syncBatch(familyId, listId, result.failedItemIds, state, listVersion),
      });
    }
  } catch (err) {
    batch = resolveShoppingBatchResult(batch, { outcome: classifyOutcome(err) });
    reportIssue(
      "shopping",
      `Azione su ${itemIds.length} articoli non salvata sul server.`,
      err,
      () => syncBatch(familyId, listId, itemIds, state, listVersion),
    );
  } finally {
    console.debug(`[shopping] batch ${batch.action}: ${batch.message}`);
  }
}

function reportIssue(
  domain: "shopping",
  message: string,
  err: unknown,
  retry: () => Promise<void>,
): void {
  logSyncFailure(message, err);
  const conflict = err instanceof ApiError && err.code === "VERSION_CONFLICT";
  reportSyncIssue({
    domain,
    message: conflict ? `${message} La lista è cambiata altrove: ricarica per vedere lo stato attuale.` : message,
    retryable: !conflict,
    retry,
  });
}

function classifyOutcome(err: unknown): "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE" {
  if (isBackendUnreachable(err)) return "OFFLINE";
  if (err instanceof ApiError && err.code === "VERSION_CONFLICT") return "CONFLICT";
  return "RETRYABLE_ERROR";
}

function logSyncFailure(action: string, err: unknown): void {
  console.warn(`[shopping] failed to sync "${action}" to the backend:`, err);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Backend non raggiungibile";
}
