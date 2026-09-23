import { useCallback, useEffect, useRef, useState } from "react";
import type { StockItem } from "../types";
import * as api from "../api/endpoints";
import { ApiError, isBackendUnreachable } from "../api/client";
import { FAMILY_ID as DEFAULT_FAMILY_ID } from "../api/config";
import { mapStockItemDtoToUi } from "../api/mappers";
import { reportSyncIssue } from "../lib/syncBus";
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
 * @param familyId The signed-in user's family id (from `AuthUser.hasFamilyId`, set at login or
 *   by Onboarding's real `POST /api/v1/families` call). Falls back to `VITE_FAMILY_ID` when not
 *   provided, for local testing before a session exists. When neither is available, or the
 *   backend is unreachable/errors, the hook falls back to the bundled demo dataset so the UI
 *   stays fully interactive.
 */
// apps/web/src/hooks/useInventory.ts — sostituisci il blocco attorno alle righe 55-100

export function useInventory(familyId?: string | null): UseInventoryResult {
  const effectiveFamilyId = familyId ?? DEFAULT_FAMILY_ID ?? null;
  const [stock, setStockState] = useState<StockItem[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;
  const familyIdRef = useRef(effectiveFamilyId);
  familyIdRef.current = effectiveFamilyId;

  // Tiene traccia dell'ultimo array di stock "sincronizzato", così il useEffect
  // sotto può calcolare il diff senza dover leggere lo state precedente da setState.
  const prevStockRef = useRef<StockItem[] | null>(null);

  useEffect(() => {
    if (!effectiveFamilyId) {
      setStockState([]);
      prevStockRef.current = [];
      setIsDemo(false);
      setDemoReason(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.listStockItems(effectiveFamilyId);
        if (cancelled) return;
        const items = res.items.map(mapStockItemDtoToUi);
        prevStockRef.current = items;   // ← stesso riferimento che diventerà lo state
        setStockState(items);
        setIsDemo(false);
        setDemoReason(null);
      } catch (err) {
        if (cancelled) return;
        setStockState([]);
        prevStockRef.current = [];
        setIsDemo(false);
        setDemoReason(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFamilyId]);

  // Side effect FUORI dall'updater: React 18 StrictMode esegue gli updater di setState
  // due volte in DEV, quindi qualunque side effect dentro l'updater (come chiamare
  // syncInventoryDiff) viene eseguito due volte e genera richieste duplicate al server.
  // Qui l'effect parte UNA VOLTA per ogni transizione reale di `stock`, e skippa il
  // primo popolamento grazie al confronto per reference con prevStockRef.
  useEffect(() => {
    const prev = prevStockRef.current;
    if (prev === null) return;              // load non ancora avvenuto
    if (prev === stock) return;             // stesso riferimento → nessun cambiamento reale
    prevStockRef.current = stock;
    if (isDemoRef.current || !familyIdRef.current) return;
    void syncInventoryDiff(familyIdRef.current, prev, stock);
  }, [stock]);

  const setStock = useCallback<SetStock>((updater) => {
    // Updater PURO: solo calcola il nuovo array. Nessun side effect qui dentro.
    setStockState((prev) =>
      typeof updater === "function" ? (updater as (p: StockItem[]) => StockItem[])(prev) : updater,
    );
  }, []);

  return { stock, setStock, isDemo, loading, demoReason };
}

async function syncInventoryDiff(familyId: string, prev: StockItem[], next: StockItem[]): Promise<void> {
  const prevById = new Map(prev.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));

  for (const item of next) {
    const before = prevById.get(item.id);
    if (before === undefined) {
      await syncCreate(familyId, item).catch((err) =>
        reportIssue("Aggiunta prodotto non salvata sul server.", err, () => syncCreate(familyId, item)),
      );
      continue;
    }
    const beforeQty = totalQuantity(before);
    const afterQty = totalQuantity(item);
    if (afterQty < beforeQty) {
      const delta = beforeQty - afterQty;
      // If-Match deve essere la versione PRIMA della modifica ottimistica:
      // il server ha ancora quella, perché non ha applicato il movimento.
      await syncMovement(familyId, item.id, before.version, "CONSUMPTION", delta, item.unit).catch((err) =>
        reportIssue(
          `Consumo di "${item.name}" non salvato sul server.`,
          err,
          () => syncMovement(familyId, item.id, before.version, "CONSUMPTION", delta, item.unit),
        ),
      );
    }
  }

  for (const item of prev) {
    if (!nextById.has(item.id)) {
      const remaining = totalQuantity(item);
      if (remaining > 0) {
        await syncMovement(familyId, item.id, item.version, "WASTE", remaining, item.unit).catch((err) =>
          reportIssue(
            `Spreco di "${item.name}" non salvato sul server.`,
            err,
            () => syncMovement(familyId, item.id, item.version, "WASTE", remaining, item.unit),
          ),
        );
      }
    }
  }
}

function reportIssue(message: string, err: unknown, retry: () => Promise<void>): void {
  logSyncFailure(message, err);
  const conflict = isConflict(err);
  reportSyncIssue({
    domain: "inventory",
    message: conflict ? `${message} La dispensa è cambiata altrove: ricarica per vedere lo stato attuale.` : message,
    retryable: !conflict,
    retry,
  });
}

async function syncCreate(familyId: string, item: StockItem): Promise<void> {
  const product = await api.createProduct({
    canonicalName: item.name,
    brand: item.brand ?? null,
    defaultUnit: normalizeUnit(item.unit),
    category: item.category,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber,
  });
  await api.createStockItem({
    familyId,
    productId: product.id,
    quantity: totalQuantity(item),
    unit: normalizeUnit(item.unit),
    reorderPoint: item.reorderPoint,
    location: item.location,
    expiresAt: item.batches.find(b => b.expiryDate)?.expiryDate,
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
