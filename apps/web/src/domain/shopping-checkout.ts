/**
 * Checkout ("Concludi la spesa"): turns what the person confirmed into a plan.
 *
 *  - purchased list items are loaded into Inventory (each purchase is a new pantry row/lot: the
 *    Inventory owner always receives the write, Shopping never writes it — docs/FLOWS.md §11) and
 *    leave the shopping list;
 *  - items in the cart that were not bought go back to "to buy";
 *  - extra products (receipt lines with no list match, or typed by hand) are loaded too.
 *
 * Pure planning only; the page applies the plan through the existing setStock / setList hooks.
 */
import { normalizeLabel } from "./shopping-suggestions.js";
import { normalizeUnit, type CanonicalUnit } from "./units.js";

export interface CheckoutListItem {
  readonly id: string;
  readonly displayName: string;
  readonly productId?: string;
  readonly quantity: number;
  readonly unit: string;
  readonly state: string;
}

export interface ReceiptLine {
  readonly name: string;
  readonly barcode?: string | null;
  readonly quantity?: number | null;
  readonly unit?: string | null;
  readonly priceMinor?: number | null;
  readonly currency?: string | null;
  readonly confidence: number;
  readonly productId?: string | null;
}

export interface CheckoutExtra {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
  readonly productId?: string;
  readonly barcode?: string;
  readonly priceMinor?: number;
  readonly currency?: string;
}

export interface ReceiptMatch {
  readonly itemId: string;
  readonly line: ReceiptLine;
}

export interface ReceiptMatchResult {
  readonly matches: readonly ReceiptMatch[];
  readonly extras: readonly CheckoutExtra[];
}

function stem(token: string): string {
  return token.replace(/[aeiou]+$/, "");
}

function tokens(value: string): string[] {
  return normalizeLabel(value)
    .split(" ")
    .filter((token) => token.length >= 3)
    .map(stem)
    .filter((token) => token.length >= 2);
}

/**
 * Loose name match for receipt text ("LATTE INTERO PARMALAT 1L") against a list label ("Latte"):
 * every token of the shorter name must appear (by stem) in the longer one.
 */
export function labelsMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) {
    const na = normalizeLabel(a);
    return na !== "" && na === normalizeLabel(b);
  }
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((token) => large.includes(token));
}

/** Each list item and each receipt line is used at most once; unmatched lines become extras. */
export function matchReceiptToList(
  lines: readonly ReceiptLine[],
  items: readonly CheckoutListItem[],
): ReceiptMatchResult {
  const used = new Set<string>();
  const matches: ReceiptMatch[] = [];
  const extras: CheckoutExtra[] = [];

  lines.forEach((line, index) => {
    const free = items.filter((item) => !used.has(item.id));
    const hit =
      (line.productId ? free.find((item) => item.productId === line.productId) : undefined) ??
      free.find((item) => labelsMatch(line.name, item.displayName));
    if (hit) {
      used.add(hit.id);
      matches.push({ itemId: hit.id, line });
      return;
    }
    const quantity = line.quantity !== null && line.quantity !== undefined && line.quantity > 0 ? line.quantity : 1;
    extras.push({
      id: `receipt-extra-${index}`,
      name: line.name,
      quantity,
      unit: line.unit ?? "piece",
      ...(line.productId ? { productId: line.productId } : {}),
      ...(line.barcode ? { barcode: line.barcode } : {}),
      ...(line.priceMinor !== null && line.priceMinor !== undefined ? { priceMinor: line.priceMinor } : {}),
      ...(line.currency ? { currency: line.currency } : {}),
    });
  });

  return { matches, extras };
}

/** Items already in the cart start as purchased. */
export function initialPurchasedIds(items: readonly CheckoutListItem[]): Set<string> {
  return new Set(items.filter((item) => item.state === "COMPLETED").map((item) => item.id));
}

export interface StockAddition {
  readonly listItemId?: string;
  readonly name: string;
  readonly productId?: string;
  readonly barcode?: string;
  readonly quantity: number;
  readonly unit: CanonicalUnit;
  readonly priceMinor?: number;
  readonly currency?: string;
}

export interface CheckoutPlan {
  readonly stockAdditions: readonly StockAddition[];
  readonly removeItemIds: readonly string[];
  readonly restoreItemIds: readonly string[];
  readonly inPantryCount: number;
  readonly staysInListCount: number;
}

export function buildCheckoutPlan(input: {
  readonly items: readonly CheckoutListItem[];
  readonly purchasedIds: ReadonlySet<string>;
  readonly extras: readonly CheckoutExtra[];
  readonly receiptMatches?: readonly ReceiptMatch[];
}): CheckoutPlan {
  const lineByItem = new Map((input.receiptMatches ?? []).map((match) => [match.itemId, match.line]));
  const purchased = input.items.filter((item) => input.purchasedIds.has(item.id) && item.quantity > 0);

  const fromList: StockAddition[] = purchased.map((item) => {
    const line = lineByItem.get(item.id);
    return {
      listItemId: item.id,
      name: item.displayName,
      ...(item.productId ? { productId: item.productId } : {}),
      ...(line?.barcode ? { barcode: line.barcode } : {}),
      quantity: item.quantity,
      unit: normalizeUnit(item.unit),
      ...(line?.priceMinor !== null && line?.priceMinor !== undefined ? { priceMinor: line.priceMinor } : {}),
      ...(line?.currency ? { currency: line.currency } : {}),
    };
  });

  const fromExtras: StockAddition[] = input.extras
    .filter((extra) => extra.name.trim() !== "" && extra.quantity > 0)
    .map((extra) => ({
      name: extra.name.trim(),
      ...(extra.productId ? { productId: extra.productId } : {}),
      ...(extra.barcode ? { barcode: extra.barcode } : {}),
      quantity: extra.quantity,
      unit: normalizeUnit(extra.unit),
      ...(extra.priceMinor !== undefined ? { priceMinor: extra.priceMinor } : {}),
      ...(extra.currency ? { currency: extra.currency } : {}),
    }));

  const stockAdditions = [...fromList, ...fromExtras];
  const removeItemIds = purchased.map((item) => item.id);
  const restoreItemIds = input.items
    .filter((item) => !input.purchasedIds.has(item.id) && item.state === "COMPLETED")
    .map((item) => item.id);

  return {
    stockAdditions,
    removeItemIds,
    restoreItemIds,
    inPantryCount: stockAdditions.length,
    staysInListCount: input.items.length - purchased.length,
  };
}

export function canCompleteCheckout(plan: CheckoutPlan): boolean {
  return plan.stockAdditions.length > 0;
}
