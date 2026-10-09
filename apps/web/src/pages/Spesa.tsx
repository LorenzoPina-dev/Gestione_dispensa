import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ShoppingItem, ShoppingList, StockItem } from "../types";
import type { ProductDto } from "../api/types";
import * as api from "../api/endpoints";
import { colors, fonts } from "../tokens";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { SourceBadge } from "../components/ui/Badge";
import { Row, RowList } from "../components/ui/ListRow";
import ShoppingPicker from "../components/shopping/ShoppingPicker";
import CheckoutModal from "../components/shopping/CheckoutModal";
import { useShoppingSuggestions, type PickerTab } from "../hooks/useShoppingSuggestions";
import { isAlreadyListed, type ShoppingSuggestion } from "../domain/shopping-suggestions";
import type { CheckoutPlan, StockAddition } from "../domain/shopping-checkout";
import { formatQuantity, formatUnit, normalizeUnit, quantityStep } from "../domain/units";

interface Props {
  list: ShoppingList;
  setList: Dispatch<SetStateAction<ShoppingList>>;
  stock: StockItem[];
  setStock: Dispatch<SetStateAction<StockItem[]>>;
  currentUserName: string;
  familyId?: string | null;
  readOnly?: boolean;
  /** Re-reads the list from the server after an out-of-band change (e.g. recipe add-missing). */
  onListRefresh?: () => Promise<void>;
}

let localCounter = 0;
function localId(prefix: string): string {
  localCounter += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${localCounter}`;
  return `${prefix}_${random}`;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h fa` : `${Math.round(hours / 24)} g fa`;
}

function toStockItem(addition: StockAddition): StockItem {
  return {
    id: localId("si"),
    ...(addition.productId ? { productId: addition.productId } : {}),
    ...(addition.barcode ? { barcode: addition.barcode } : {}),
    name: addition.name,
    unit: addition.unit,
    location: "dispensa",
    category: "Altro",
    // Every purchase is its own pantry row/lot; expiry is left empty so Shelf-Life estimates it.
    batches: [{ quantity: addition.quantity }],
    provenance: addition.productId ? "VERIFIED" : "IMPORTED",
    version: 1,
  };
}

export default function Spesa({ list, setList, stock, setStock, currentUserName, familyId, readOnly = false, onListRefresh }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("REORDER");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<number | null>(null);

  const suggestions = useShoppingSuggestions({ familyId, open: pickerOpen, tab, stock, list });

  const toBuy = useMemo(() => list.items.filter((i) => i.state !== "COMPLETED"), [list.items]);
  const inCart = useMemo(() => list.items.filter((i) => i.state === "COMPLETED"), [list.items]);

  useEffect(() => () => { if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current); }, []);

  function notify(message: string) {
    setFeedback(message);
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 3200);
  }

  function updateList(fn: (items: ShoppingItem[]) => ShoppingItem[]) {
    setList((current) => ({
      ...current,
      version: current.version + 1,
      lastEditedBy: currentUserName,
      lastEditedAt: new Date().toISOString(),
      items: fn(current.items),
    }));
  }

  function addItem(input: Pick<ShoppingItem, "displayName" | "quantity" | "unit" | "sourceType"> & Partial<Pick<ShoppingItem, "productId" | "sourceRef">>): boolean {
    if (isAlreadyListed(list.items, { productId: input.productId, label: input.displayName })) {
      notify(`«${input.displayName}» è già nella lista.`);
      return false;
    }
    const item: ShoppingItem = {
      id: localId("sli"),
      displayName: input.displayName,
      quantity: input.quantity,
      unit: normalizeUnit(input.unit),
      state: "ACCEPTED",
      sourceType: input.sourceType,
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      version: 1,
      addedBy: currentUserName,
      addedAt: new Date().toISOString(),
    };
    updateList((items) => [...items, item]);
    notify(`«${input.displayName}» aggiunto alla spesa.`);
    return true;
  }

  function addSuggestion(s: ShoppingSuggestion) {
    addItem({ displayName: s.label, quantity: s.quantity, unit: s.unit, sourceType: s.source, productId: s.productId, sourceRef: s.sourceRef });
  }

  function addProduct(product: ProductDto, packageCount: number) {
    const packageValue = product.quantityValue;
    const rawPackageUnit = product.quantityUnit?.trim();
    const hasPackageMeasure =
      packageValue != null &&
      Number.isFinite(packageValue) &&
      packageValue > 0 &&
      rawPackageUnit !== undefined &&
      rawPackageUnit.length > 0;

    if (hasPackageMeasure) {
      const unit = normalizeUnit(rawPackageUnit);
      addItem({
        displayName: product.canonicalName,
        quantity: Math.round(packageValue * packageCount * 1000) / 1000,
        unit,
        sourceType: "MANUAL",
        productId: product.id,
      });
      return;
    }

    // Without a reliable package measure, keep the purchase explicitly as packages rather than
    // inventing "1 g" or another physical quantity that the catalog does not provide.
    addItem({
      displayName: product.canonicalName,
      quantity: packageCount,
      unit: "pack",
      sourceType: "MANUAL",
      productId: product.id,
    });
  }

  async function addRecipeAll(recipeId: string, title: string) {
    if (!familyId) return;
    try {
      const result = await api.addRecipeMissingIngredients(familyId, recipeId);
      await onListRefresh?.();
      notify(result.itemIds.length > 0 ? `Ingredienti di «${title}» aggiunti.` : "Non c'era nulla da aggiungere.");
    } catch {
      notify("Impossibile aggiungere gli ingredienti. Riprova.");
    }
  }

  function toggleCart(id: string) {
    updateList((items) =>
      items.map((i) => (i.id === id ? { ...i, state: i.state === "COMPLETED" ? "ACCEPTED" : "COMPLETED", version: i.version + 1 } : i)),
    );
  }

  function changeQuantity(id: string, direction: 1 | -1) {
    updateList((items) =>
      items.map((i) => {
        if (i.id !== id) return i;
        const unit = normalizeUnit(i.unit);
        const next = Math.round((i.quantity + direction * quantityStep(unit)) * 1000) / 1000;
        return next > 0 ? { ...i, quantity: next, version: i.version + 1 } : i;
      }),
    );
  }

  function removeItem(id: string) {
    updateList((items) => items.filter((i) => i.id !== id));
  }

  function applyCheckout(plan: CheckoutPlan) {
    const remove = new Set(plan.removeItemIds);
    const restore = new Set(plan.restoreItemIds);
    // Inventory sync creates one pantry row per addition (hooks/useInventory); Shopping drops the bought items.
    setStock((current) => [...current, ...plan.stockAdditions.map(toStockItem)]);
    updateList((items) =>
      items
        .filter((i) => !remove.has(i.id))
        .map((i) => (restore.has(i.id) ? { ...i, state: "ACCEPTED" as const, version: i.version + 1 } : i)),
    );
    setCheckoutOpen(false);
    notify(`${plan.inPantryCount} prodotti aggiunti alla dispensa.`);
  }

  function openPicker(nextTab: PickerTab) {
    setTab(nextTab);
    setPickerOpen(true);
  }

  const lowStockCount = suggestions.reorder.length;

  function renderItem(item: ShoppingItem, index: number, last: boolean) {
    const inBasket = item.state === "COMPLETED";
    return (
      <Row key={item.id} index={index} last={last}>
        <button
          onClick={() => toggleCart(item.id)}
          disabled={readOnly}
          aria-pressed={inBasket}
          aria-label={`${item.displayName}: ${inBasket ? "nel carrello" : "da acquistare"}`}
          className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 text-xs"
          style={{ borderColor: inBasket ? colors.sage : colors.border, backgroundColor: inBasket ? colors.sage : "transparent", color: colors.white }}
        >
          {inBasket ? "✓" : ""}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: inBasket ? colors.inkMuted : colors.ink, textDecoration: inBasket ? "line-through" : "none" }}>
            {item.displayName}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px]" style={{ color: colors.inkMuted }}>
              {formatQuantity(item.quantity)} {formatUnit(item.unit)}
              {item.addedBy ? ` · ${item.addedBy.split(" ")[0]}` : ""}
            </span>
            <SourceBadge sourceType={item.sourceType} />
          </div>
        </div>
        {!readOnly && !inBasket && (
          <div className="flex items-center gap-1 shrink-0">
            <button aria-label={`Diminuisci ${item.displayName}`} onClick={() => changeQuantity(item.id, -1)} className="w-7 h-7 rounded-lg text-sm" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>−</button>
            <button aria-label={`Aumenta ${item.displayName}`} onClick={() => changeQuantity(item.id, 1)} className="w-7 h-7 rounded-lg text-sm" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>+</button>
          </div>
        )}
        {!readOnly && (
          <button aria-label={`Rimuovi ${item.displayName}`} onClick={() => removeItem(item.id)} className="w-7 h-7 rounded-lg text-sm shrink-0" style={{ color: colors.inkMuted }}>×</button>
        )}
      </Row>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Spesa</h2>
          <p className="text-xs mt-1" style={{ color: colors.inkMuted }}>
            {toBuy.length} da acquistare{inCart.length > 0 ? ` · ${inCart.length} nel carrello` : ""}
            {list.lastEditedBy ? ` · aggiornata da ${list.lastEditedBy.split(" ")[0]} ${relativeTime(list.lastEditedAt)}` : ""}
          </p>
        </div>
        {!readOnly && <Button onClick={() => openPicker(lowStockCount > 0 ? "REORDER" : "SEARCH")}>+ Aggiungi</Button>}
      </div>

      {!readOnly && lowStockCount > 0 && (
        <button
          onClick={() => openPicker("REORDER")}
          className="w-full text-left rounded-2xl px-4 py-3 text-sm"
          style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}
        >
          <strong>{lowStockCount}</strong> {lowStockCount === 1 ? "prodotto sta finendo" : "prodotti stanno finendo"} — vedi i suggerimenti →
        </button>
      )}

      {list.items.length === 0 ? (
        <EmptyState
          icon="🛒"
          title="La lista è vuota"
          description="Aggiungi prodotti a mano, dalle scorte che finiscono, dalle ricette o dalle offerte."
          action={readOnly ? undefined : { label: "Aggiungi prodotto", onClick: () => openPicker("SEARCH") }}
        />
      ) : (
        <>
          {toBuy.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: colors.inkMuted }}>Da acquistare</p>
              <RowList>{toBuy.map((item, i) => renderItem(item, i, i === toBuy.length - 1))}</RowList>
            </section>
          )}
          {inCart.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: colors.inkMuted }}>Nel carrello</p>
              <RowList>{inCart.map((item, i) => renderItem(item, i, i === inCart.length - 1))}</RowList>
            </section>
          )}
          {!readOnly && (
            <Button className="w-full" onClick={() => setCheckoutOpen(true)}>Concludi la spesa</Button>
          )}
        </>
      )}

      {pickerOpen && (
        <ShoppingPicker
          tab={tab}
          onTab={setTab}
          onClose={() => setPickerOpen(false)}
          suggestions={suggestions}
          listItems={list.items}
          onAddSuggestion={addSuggestion}
          onAddRecipeAll={addRecipeAll}
          onAddCustom={(name) => addItem({ displayName: name, quantity: 1, unit: "piece", sourceType: "MANUAL" })}
          onAddProduct={addProduct}
        />
      )}

      {checkoutOpen && (
        <CheckoutModal
          items={list.items}
          familyId={familyId}
          onClose={() => setCheckoutOpen(false)}
          onComplete={applyCheckout}
        />
      )}

      {feedback && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-8 z-[60] px-4 py-2 rounded-full text-xs font-medium shadow-lg"
          style={{ backgroundColor: colors.ink, color: colors.white }}
        >
          {feedback}
        </div>
      )}
    </div>
  );
}
