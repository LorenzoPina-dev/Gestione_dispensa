import { useCallback, useEffect, useRef, useState } from "react";
import type { StockItem } from "../types";
import { stockItems as mockStockItems } from "../mockData";
import * as api from "../api/endpoints";
import { ApiError, isBackendUnreachable } from "../api/client";
import { FAMILY_ID } from "../api/config";
import { mapStockItemDtoToUi } from "../api/mappers";
import {
  beginInventoryAction,
  resolveInventoryResult,
  type InventoryAction,
} from "../domain/inventory-journey";

export type SetStock = React.Dispatch<React.SetStateAction<StockItem[]>>;

export interface UseInventoryResult {
  stock: StockItem[];
  setStock: SetStock;
  /** True while running against demo/mock data because the backend is unreachable or errored. */
  isDemo: boolean;
  loading: boolean;
  /** Human readable reason the app fell back to demo mode, if any. */
  demoReason: string | null;
}

/**
 * Loads the family's live inventory from `GET /api/v1/inventory/stock-items?familyId=...` and
 * keeps it in sync with the backend as the UI mutates it. Pages built from the Figma export only
 * know how to call `setStock(updater)`, exactly like `useState`'s setter, so this hook diffs the
 * previous and next arrays to infer which domain mutation happened and fires the matching
 * endpoint:
 *
 *  - a brand new item (from AddProductModal) -> POST /catalog/products then POST
 *    /inventory/stock-items (the real backend has no "create item with a free-text name" call;
 *    a catalog Product must exist first)
 *  - a batch quantity decrease on an existing item -> POST .../movements (CONSUMPTION), with the
 *    item's current `version` sent as the `If-Match` header, exactly as the controller requires
 *  - an item disappearing entirely ("waste" button) -> POST .../movements (WASTE) for the
 *    remaining quantity
 *
 * Requires `VITE_FAMILY_ID` to be set (see api/config.ts for why). Without it, or when the
 * backend is unreachable/errors, the hook falls back to the bundled demo dataset so the UI stays
 * fully interactive.
 */
export function useInventory(): UseInventoryResult {
  const [stock, setStockState] = useState<StockItem[]>(mockStockItems);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;

  useEffect(() => {
    if (!FAMILY_ID) {
      setStockState(mockStockItems);
      setIsDemo(true);
      setDemoReason("VITE_FAMILY_ID non configurato");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listStockItems(FAMILY_ID);
        if (cancelled) return;
        setStockState(res.items.map(mapStockItemDtoToUi));
        setIsDemo(false);
        setDemoReason(null);
      } catch (err) {
        if (cancelled) return;
        setStockState(mockStockItems);
        setIsDemo(true);
        setDemoReason(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setStock = useCallback<SetStock>((updater) => {
    setStockState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: StockItem[]) => StockItem[])(prev) : updater;
      if (!isDemoRef.current && FAMILY_ID) void syncInventoryDiff(FAMILY_ID, prev, next);
      return next;
    });
  }, []);

  return { stock, setStock, isDemo, loading, demoReason };
}

async function syncInventoryDiff(familyId: string, prev: StockItem[], next: StockItem[]): Promise<void> {
  const prevById = new Map(prev.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));

  for (const item of next) {
    const before = prevById.get(item.id);
    if (before === undefined) {
      await syncCreate(familyId, item).catch((err) => logSyncFailure("RECEIPT", err));
      continue;
    }
    const beforeQty = totalQuantity(before);
    const afterQty = totalQuantity(item);
    if (afterQty < beforeQty) {
      await syncMovement(familyId, item.id, item.version, "CONSUMPTION", beforeQty - afterQty, item.unit).catch(
        (err) => logSyncFailure("CONSUMPTION", err),
      );
    }
  }

  for (const item of prev) {
    if (!nextById.has(item.id)) {
      const remaining = totalQuantity(item);
      if (remaining > 0) {
        await syncMovement(familyId, item.id, item.version, "WASTE", remaining, item.unit).catch((err) =>
          logSyncFailure("WASTE", err),
        );
      }
    }
  }
}

async function syncCreate(familyId: string, item: StockItem): Promise<void> {
  const product = await api.createProduct({
    canonicalName: item.name,
    brand: item.brand ?? null,
    defaultUnit: normalizeUnit(item.unit),
  });
  await api.createStockItem({
    familyId,
    productId: product.id,
    quantity: totalQuantity(item),
    unit: normalizeUnit(item.unit),
    reorderPoint: item.reorderPoint,
  });
}

async function syncMovement(
  familyId: string,
  stockItemId: string,
  version: number,
  kind: InventoryAction,
  quantity: number,
  unit: string,
): Promise<void> {
  let journey = beginInventoryAction(kind, version);
  try {
    await api.recordMovement(stockItemId, version, {
      familyId,
      kind,
      quantity,
      unit: normalizeUnit(unit),
      occurredAt: new Date().toISOString(),
    });
    journey = resolveInventoryResult(journey, "SUCCESS");
  } catch (err) {
    journey = resolveInventoryResult(
      journey,
      isConflict(err) ? "CONFLICT" : isBackendUnreachable(err) ? "OFFLINE" : "RETRYABLE_ERROR",
    );
    throw err;
  } finally {
    console.debug(`[inventory] ${journey.action}: ${journey.message}`);
  }
}

function totalQuantity(item: StockItem): number {
  return item.batches.reduce((sum, batch) => sum + batch.quantity, 0);
}

function normalizeUnit(unit: string): "g" | "kg" | "ml" | "l" | "piece" | "pack" {
  const u = unit.toLowerCase();
  if (u === "g" || u === "kg" || u === "ml" || u === "l") return u;
  if (u === "pz" || u === "pezzo" || u === "pezzi") return "piece";
  return "pack";
}

function logSyncFailure(action: string, err: unknown): void {
  // Non-fatal: the UI already applied the optimistic update. We log for visibility instead of
  // rolling back, since the demo/offline UX intentionally favours staying interactive.
  console.warn(`[inventory] failed to sync "${action}" to the backend:`, err);
}

function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.code === "VERSION_CONFLICT";
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Backend non raggiungibile";
}
