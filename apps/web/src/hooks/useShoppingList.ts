import { useCallback, useEffect, useRef, useState } from "react";
import type { ShoppingList } from "../types";
import { shoppingList as mockShoppingList } from "../mockData";
import * as api from "../api/endpoints";
import { isNotFound } from "../api/client";
import { FAMILY_ID } from "../api/config";
import { mapActiveShoppingListDtoToUi } from "../api/mappers";

export type SetShoppingList = React.Dispatch<React.SetStateAction<ShoppingList>>;

export interface UseShoppingListResult {
  list: ShoppingList;
  setList: SetShoppingList;
  isDemo: boolean;
  loading: boolean;
  demoReason: string | null;
}

/**
 * Loads `GET /api/v1/shopping/lists/active?familyId=...` and syncs new items back with
 * `POST /api/v1/shopping/lists/{id}/items`.
 *
 * Important limitation: the real backend has no endpoint to change an item's state (accept,
 * snooze, complete, ...) or to batch-update several items — `ShoppingController` only exposes
 * create-list and add-item (see apps/api/src/shopping/controller.ts). So `Spesa.tsx`'s
 * accept/complete/batch-accept actions stay optimistic-local-only even when connected: they
 * update the on-screen list immediately but are not persisted server-side. Only newly added
 * items are synced. This is a genuine backend gap, not a client bug — extending
 * `ShoppingController`/`ShoppingService` with item-state mutations would remove this limitation.
 */
export function useShoppingList(): UseShoppingListResult {
  const [list, setListState] = useState<ShoppingList>(mockShoppingList);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;

  useEffect(() => {
    if (!FAMILY_ID) {
      setListState(mockShoppingList);
      setIsDemo(true);
      setDemoReason("VITE_FAMILY_ID non configurato");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dto = await api.getActiveShoppingList(FAMILY_ID);
        if (cancelled) return;
        setListState(mapActiveShoppingListDtoToUi(dto));
        setIsDemo(false);
        setDemoReason(null);
      } catch (err) {
        if (isNotFound(err)) {
          // No active list yet for this family — legitimate empty state, not a failure. Create
          // one so the UI has a real (non-demo) list to add items to.
          try {
            const created = await api.createShoppingList(FAMILY_ID, "Spesa settimanale");
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
  }, []);

  const setList = useCallback<SetShoppingList>((updater) => {
    setListState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: ShoppingList) => ShoppingList)(prev) : updater;
      if (!isDemoRef.current && FAMILY_ID) void syncNewItems(FAMILY_ID, prev, next);
      return next;
    });
  }, []);

  return { list, setList, isDemo, loading, demoReason };
}

async function syncNewItems(familyId: string, prev: ShoppingList, next: ShoppingList): Promise<void> {
  const prevIds = new Set(prev.items.map((item) => item.id));
  const created = next.items.filter((item) => !prevIds.has(item.id));
  for (const item of created) {
    await api
      .addShoppingItem(familyId, next.id, {
        displayName: item.displayName,
        quantity: item.quantity,
        unit: item.unit,
        sourceType: item.sourceType,
      })
      .catch((err) => console.warn("[shopping] failed to sync new item to the backend:", err));
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Backend non raggiungibile";
}
