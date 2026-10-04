import { useCallback, useEffect, useRef, useState } from "react";
import type { ShoppingItem, ShoppingList } from "../types";
import * as api from "../api/endpoints";
import type { ShoppingItemPatch } from "../api/endpoints";
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
import { normalizeUnit } from "../domain/units";

export type SetShoppingList = React.Dispatch<React.SetStateAction<ShoppingList>>;

export interface UseShoppingListResult {
  list: ShoppingList;
  setList: SetShoppingList;
  /** Re-reads the active list from the server and makes it the new sync baseline (no re-POSTs). */
  refresh: () => Promise<void>;
  isDemo: boolean;
  loading: boolean;
  demoReason: string | null;
}

const EMPTY_LIST: ShoppingList = { id: "", name: "Spesa", status: "ACTIVE", version: 0, items: [] };

/** Session-only data the server does not store (who added what) plus optimistic→server ids. */
interface LocalMeta {
  attribution: Map<string, { addedBy?: string; addedAt?: string }>;
  idMap: Map<string, string>;
  listId?: string;
  lastEditedBy?: string;
  lastEditedAt?: string;
}

interface SyncContext {
  meta: LocalMeta;
  refresh: () => Promise<void>;
}

/**
 * Keeps the active shopping list in sync with Shopping through the gateway.
 *
 * Same contract as `useInventory`: pages call `setList(updater)` like React state and this hook
 * diffs the before/after lists to decide which endpoint to call:
 *
 *  - new item            -> POST   /shopping/lists/{id}/items  (source = manual|recipe|low_stock|offer)
 *  - quantity/unit/check -> PATCH  /shopping/lists/{id}/items/{itemId}  (If-Match = item version)
 *  - removed item        -> DELETE /shopping/lists/{id}/items/{itemId}   (If-Match = item version)
 *
 * Shopping persists one flag, so `COMPLETED` (in the cart) <-> `checked: true`; everything else on
 * the server is "still to buy". Writes run one at a time (so If-Match versions stay consistent)
 * and, once the queue is empty, the canonical list is reloaded: optimistic ids are replaced by
 * server ids/versions. If the family has no open list yet, the first write creates it.
 */
export function useShoppingList(familyId?: string | null, initialList?: ShoppingList | null): UseShoppingListResult {
  const effectiveFamilyId = familyId ?? DEFAULT_FAMILY_ID ?? null;
  const [list, setListState] = useState<ShoppingList>(EMPTY_LIST);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;
  const familyIdRef = useRef(effectiveFamilyId);
  familyIdRef.current = effectiveFamilyId;
  const prevListRef = useRef<ShoppingList | null>(null);
  const hydrationTargetRef = useRef<ShoppingList | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const metaRef = useRef<LocalMeta>({ attribution: new Map(), idMap: new Map() });

  /** Installs a server-side list as the sync baseline, re-attaching session-only attribution. */
  const hydrate = useCallback((next: ShoppingList) => {
    const meta = metaRef.current;
    const decorated: ShoppingList = {
      ...next,
      items: next.items.map((item) => {
        const local = meta.attribution.get(item.id);
        return local ? { ...item, addedBy: item.addedBy ?? local.addedBy, addedAt: item.addedAt ?? local.addedAt } : item;
      }),
      lastEditedBy: next.lastEditedBy ?? meta.lastEditedBy,
      lastEditedAt: next.lastEditedAt ?? meta.lastEditedAt,
    };
    meta.idMap.clear();
    if (decorated.id) meta.listId = decorated.id;
    hydrationTargetRef.current = decorated;
    prevListRef.current = decorated;
    setListState(decorated);
  }, []);

  const loadCanonical = useCallback(async (family: string): Promise<ShoppingList | null> => {
    try {
      return mapActiveShoppingListDtoToUi(await api.getActiveShoppingList(family));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    const family = familyIdRef.current;
    if (!family) return;
    await queueRef.current; // let in-flight writes land first
    const next = await loadCanonical(family);
    hydrate(next ?? EMPTY_LIST);
  }, [hydrate, loadCanonical]);

  useEffect(() => {
    if (initialList !== undefined) {
      // Composite hydration is the authoritative remote baseline, but never clobber edits in flight.
      if (pendingRef.current > 0) return;
      hydrate(initialList ?? EMPTY_LIST);
      setIsDemo(false);
      setDemoReason(null);
      setLoading(false);
      return;
    }
    if (!effectiveFamilyId) {
      hydrate(EMPTY_LIST);
      setIsDemo(false);
      setDemoReason("Nessuna famiglia attiva");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await loadCanonical(effectiveFamilyId);
        if (cancelled) return;
        // No open list yet is a legitimate empty state; the first write creates one.
        hydrate(next ?? EMPTY_LIST);
        setIsDemo(false);
        setDemoReason(null);
      } catch (err) {
        if (cancelled) return;
        hydrate(EMPTY_LIST);
        setIsDemo(false);
        setDemoReason(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFamilyId, initialList, hydrate, loadCanonical]);

  const enqueue = useCallback((task: () => Promise<void>) => {
    pendingRef.current += 1;
    queueRef.current = queueRef.current
      .then(task)
      .catch(() => undefined)
      .then(async () => {
        pendingRef.current -= 1;
        if (pendingRef.current !== 0) return;
        const family = familyIdRef.current;
        if (!family) return;
        const reload = async () => {
          const canonical = await loadCanonical(family);
          if (pendingRef.current === 0 && canonical) hydrate(canonical);
        };
        try {
          await reload();
        } catch (err) {
          reportIssue("Impossibile riallineare la lista della spesa con il server.", err, reload);
        }
      });
  }, [hydrate, loadCanonical]);

  // Side effects live OUTSIDE the state updater so StrictMode cannot duplicate network writes.
  useEffect(() => {
    if (hydrationTargetRef.current !== null) {
      if (list !== hydrationTargetRef.current) return;
      hydrationTargetRef.current = null;
      prevListRef.current = list;
      return;
    }
    const prev = prevListRef.current;
    if (prev === null || prev === list) return;
    prevListRef.current = list;
    const family = familyIdRef.current;
    if (isDemoRef.current || !family) return;
    metaRef.current.lastEditedBy = list.lastEditedBy;
    metaRef.current.lastEditedAt = list.lastEditedAt;
    enqueue(() => syncShoppingDiff(family, prev, list, { meta: metaRef.current, refresh }));
  }, [list, enqueue, refresh]);

  const setList = useCallback<SetShoppingList>((updater) => {
    setListState((prev) =>
      typeof updater === "function" ? (updater as (p: ShoppingList) => ShoppingList)(prev) : updater,
    );
  }, []);

  return { list, setList, refresh, isDemo, loading, demoReason };
}

async function resolveListId(familyId: string, known: string, ctx: SyncContext): Promise<string> {
  const existing = known || ctx.meta.listId;
  if (existing) return existing;
  let listId: string;
  try {
    listId = (await api.getActiveShoppingList(familyId)).list.listId;
  } catch (err) {
    if (!isNotFound(err)) throw err;
    listId = (await api.createShoppingList(familyId, "Spesa settimanale")).id;
  }
  ctx.meta.listId = listId;
  return listId;
}

interface PendingUpdate {
  item: ShoppingItem;
  before: ShoppingItem;
  patch: ShoppingItemPatch;
}

function diffItem(before: ShoppingItem, item: ShoppingItem): ShoppingItemPatch | null {
  const patch: ShoppingItemPatch = {};
  if (item.displayName !== before.displayName) patch.label = item.displayName;
  if (item.quantity !== before.quantity) patch.quantity = item.quantity;
  if (normalizeUnit(item.unit) !== normalizeUnit(before.unit)) patch.unit = normalizeUnit(item.unit);
  if ((item.state === "COMPLETED") !== (before.state === "COMPLETED")) patch.checked = item.state === "COMPLETED";
  return Object.keys(patch).length > 0 ? patch : null;
}

async function syncShoppingDiff(familyId: string, prev: ShoppingList, next: ShoppingList, ctx: SyncContext): Promise<void> {
  const prevById = new Map(prev.items.map((item) => [item.id, item]));
  const nextById = new Map(next.items.map((item) => [item.id, item]));
  const knownListId = next.id || prev.id;

  for (const item of next.items.filter((i) => !prevById.has(i.id))) {
    const create = async () => {
      const listId = await resolveListId(familyId, knownListId, ctx);
      const dto = await api.addShoppingItem(familyId, listId, {
        displayName: item.displayName,
        quantity: item.quantity,
        unit: normalizeUnit(item.unit),
        sourceType: item.sourceType,
        ...(item.productId ? { productId: item.productId } : {}),
        ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
        // Stable per optimistic id: a retry replays instead of creating a duplicate.
        idempotencyKey: `shopping-add:${familyId}:${item.id}`,
      });
      ctx.meta.idMap.set(item.id, dto.itemId);
      ctx.meta.attribution.set(dto.itemId, { addedBy: item.addedBy, addedAt: item.addedAt });
    };
    await create().catch((err) =>
      reportIssue(`Aggiunta di "${item.displayName}" non salvata sul server.`, err, () => create().then(ctx.refresh)),
    );
  }

  const updates: PendingUpdate[] = [];
  for (const item of next.items) {
    const before = prevById.get(item.id);
    if (!before) continue;
    const patch = diffItem(before, item);
    if (patch) updates.push({ item, before, patch });
  }

  const onlyChecked = updates.length > 1 && updates.every((u) => Object.keys(u.patch).length === 1 && u.patch.checked !== undefined);
  const sameTarget = onlyChecked && updates.every((u) => u.patch.checked === updates[0]?.patch.checked);
  if (sameTarget) {
    await syncBatch(familyId, knownListId || ctx.meta.listId || "", updates, ctx);
  } else {
    for (const update of updates) await syncPatch(familyId, knownListId || ctx.meta.listId || "", update, ctx);
  }

  for (const item of prev.items) {
    if (nextById.has(item.id)) continue;
    const remove = async () => {
      const serverId = ctx.meta.idMap.get(item.id) ?? item.id;
      await api.deleteShoppingItem(familyId, knownListId || ctx.meta.listId || "", serverId, item.version, `shopping-delete:${serverId}:${item.version}`);
    };
    await remove().catch((err) =>
      reportIssue(`Rimozione di "${item.displayName}" non salvata sul server.`, err, () => remove().then(ctx.refresh)),
    );
  }
}

function actionFor(patch: ShoppingItemPatch): ShoppingAction {
  if (patch.checked === true) return "COMPLETE";
  if (patch.checked === false && Object.keys(patch).length === 1) return "ACCEPT";
  return "EDIT";
}

async function syncPatch(familyId: string, listId: string, update: PendingUpdate, ctx: SyncContext): Promise<void> {
  const { item, before, patch } = update;
  const serverId = ctx.meta.idMap.get(item.id) ?? item.id;
  const send = () =>
    api.updateShoppingItem(familyId, listId, serverId, before.version, patch, `shopping-update:${serverId}:${before.version}:${JSON.stringify(patch)}`);
  let journey = beginShoppingAction(actionFor(patch), before.version);
  try {
    await send();
    journey = resolveShoppingResult(journey, "SUCCESS");
  } catch (err) {
    journey = resolveShoppingResult(journey, classifyOutcome(err));
    reportIssue(`Modifica di "${item.displayName}" non salvata sul server.`, err, () => send().then(ctx.refresh));
  } finally {
    console.debug(`[shopping] ${journey.action}: ${journey.message}`);
  }
}

async function syncBatch(familyId: string, listId: string, updates: PendingUpdate[], ctx: SyncContext): Promise<void> {
  const state = updates[0]?.patch.checked ? "COMPLETED" : "ACCEPTED";
  const entries = updates.map((u) => ({ itemId: ctx.meta.idMap.get(u.item.id) ?? u.item.id, version: u.before.version }));
  // Batch vocabulary only knows ACCEPT/REJECT; it is used for logging and partial-failure reporting.
  let batch = beginShoppingBatchAction("ACCEPT", entries.map((e) => e.itemId), updates[0]?.item.version ?? 0);
  const run = async (items: typeof entries) => {
    const result = await api.batchUpdateShoppingItems(familyId, listId, items, state);
    if (result.failedItemIds.length > 0) {
      const failed = items.filter((e) => result.failedItemIds.includes(e.itemId));
      batch = resolveShoppingBatchResult(batch, { outcome: "PARTIAL_SUCCESS", failedItemIds: result.failedItemIds });
      reportSyncIssue({
        domain: "shopping",
        message: `${failed.length} articoli non aggiornati sul server.`,
        retryable: true,
        retry: () => run(failed).then(ctx.refresh),
      });
    } else {
      batch = resolveShoppingBatchResult(batch, { outcome: "SUCCESS" });
    }
  };
  try {
    await run(entries);
  } catch (err) {
    batch = resolveShoppingBatchResult(batch, { outcome: classifyOutcome(err) });
    reportIssue(`Azione su ${entries.length} articoli non salvata sul server.`, err, () => run(entries).then(ctx.refresh));
  } finally {
    console.debug(`[shopping] batch ${batch.action}: ${batch.message}`);
  }
}

function isConflict(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 412 || err.code === "VERSION_CONFLICT" || err.code === "PRECONDITION_FAILED");
}

function classifyOutcome(err: unknown): "CONFLICT" | "RETRYABLE_ERROR" | "OFFLINE" {
  if (isBackendUnreachable(err)) return "OFFLINE";
  if (isConflict(err)) return "CONFLICT";
  return "RETRYABLE_ERROR";
}

function reportIssue(message: string, err: unknown, retry: () => Promise<void>): void {
  console.warn(`[shopping] ${message}`, err);
  const conflict = isConflict(err);
  reportSyncIssue({
    domain: "shopping",
    message: conflict ? `${message} La lista è cambiata altrove: ricarica per vedere lo stato attuale.` : message,
    retryable: !conflict,
    retry,
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Backend non raggiungibile";
}
