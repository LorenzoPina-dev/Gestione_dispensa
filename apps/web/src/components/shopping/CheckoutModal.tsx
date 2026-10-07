import { useEffect, useMemo, useRef, useState } from "react";
import type { ShoppingItem } from "../../types";
import * as api from "../../api/endpoints";
import { isBackendUnreachable } from "../../api/client";
import { useReceiptScan } from "../../hooks/useReceiptScan";
import { isReceiptScanSettled } from "../../domain/receipt-scan";
import {
  buildCheckoutPlan,
  canCompleteCheckout,
  initialPurchasedIds,
  matchReceiptToList,
  type CheckoutExtra,
  type CheckoutPlan,
  type ReceiptMatch,
} from "../../domain/shopping-checkout";
import { formatQuantity, formatUnit, isKnownUnit, normalizeUnit } from "../../domain/units";
import { colors, fonts } from "../../tokens";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import Button from "../ui/Button";
import { Row, RowList } from "../ui/ListRow";
import ProductSearch from "./ProductSearch";

interface Props {
  items: ShoppingItem[];
  familyId: string | null | undefined;
  onClose: () => void;
  /** Applies the plan: load purchased items into the pantry and update the list. */
  onComplete: (plan: CheckoutPlan) => void;
}

type Step = "RECEIPT" | "ANALYZING" | "REVIEW";

export default function CheckoutModal({ items, familyId, onClose, onComplete }: Props) {
  const scan = useReceiptScan(familyId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("RECEIPT");
  const [purchased, setPurchased] = useState<Set<string>>(() => initialPurchasedIds(items));
  const [extras, setExtras] = useState<CheckoutExtra[]>([]);
  const [matches, setMatches] = useState<ReceiptMatch[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once the OCR journey settles, pre-select what the receipt recognised.
  useEffect(() => {
    if (step !== "ANALYZING" || !isReceiptScanSettled(scan.model)) return;
    if (scan.model.state === "READY") {
      const result = matchReceiptToList(scan.lines, items);
      setMatches([...result.matches]);
      setExtras([...result.extras]);
      setPurchased((current) => new Set([...current, ...result.matches.map((m) => m.itemId)]));
    }
    setStep("REVIEW");
  }, [step, scan.model, scan.lines, items]);

  const plan = useMemo(
    () => buildCheckoutPlan({ items, purchasedIds: purchased, extras, receiptMatches: matches }),
    [items, purchased, extras, matches],
  );

  function toggle(id: string) {
    setPurchased((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function addExtra(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setExtras((current) => [...current, { id: "manual-extra-" + Date.now() + "-" + current.length, name: trimmed, quantity: 1, unit: "piece" }]);
  }

  function addProductFromSearch(product: import("../../api/types").ProductDto) {
    const listed = items.find((item) => item.productId === product.id);
    if (listed) {
      setPurchased((current) => new Set([...current, listed.id]));
      return;
    }

    setExtras((current) => {
      if (current.some((extra) => extra.productId === product.id)) return current;
      const packageValue = product.quantityValue;
      const packageUnit = product.quantityUnit?.trim();
      const hasPackageMeasure =
        packageValue != null &&
        Number.isFinite(packageValue) &&
        packageValue > 0 &&
        !!packageUnit &&
        isKnownUnit(packageUnit);
      const quantity = hasPackageMeasure ? packageValue : 1;
      const unit = hasPackageMeasure ? normalizeUnit(packageUnit) : "pack";
      return [
        ...current,
        {
          id: "manual-product-" + product.id,
          name: product.canonicalName,
          quantity,
          unit,
          productId: product.id,
        },
      ];
    });
  }

  async function changeReceipt() {
    await scan.discard();
    setMatches([]);
    setExtras([]);
    setPurchased(initialPurchasedIds(items));
    setStep("RECEIPT");
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      // The OCR draft is confirmed first: Inventory is only touched once the review is recorded.
      if (scan.draftId) {
        await api.confirmOcrDraft(
          scan.draftId,
          plan.stockAdditions.map((a) => ({
            name: a.name,
            productId: a.productId ?? null,
            quantity: a.quantity,
            unit: a.unit,
            priceMinor: a.priceMinor ?? null,
            currency: a.currency ?? null,
          })),
        );
      }
      onComplete(plan);
    } catch (err) {
      setError(isBackendUnreachable(err) ? "Impossibile contattare il server. Riprova." : "Non è stato possibile registrare la verifica dello scontrino. Riprova.");
      setSubmitting(false);
    }
  }

  const noticeByState: Partial<Record<typeof scan.model.state, string>> = {
    MANUAL_REQUIRED: "Non sono riuscito a leggere lo scontrino. Segna tu cosa hai acquistato.",
    FAILED: scan.model.message.startsWith("Only") || scan.model.message.startsWith("The image")
      ? "Formato non supportato: usa una foto JPEG, PNG o WebP sotto i 10 MB."
      : "Lo scontrino non è stato elaborato. Segna tu cosa hai acquistato.",
    OFFLINE: "Sei offline: la lettura dello scontrino non è disponibile. Segna tu cosa hai acquistato.",
  };

  return (
    <Modal onClose={submitting ? undefined : onClose} maxWidth="max-w-lg">
      <div className="p-4 space-y-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Concludi la spesa</h3>
          <button onClick={onClose} disabled={submitting} aria-label="Chiudi" className="w-8 h-8 rounded-full" style={{ backgroundColor: colors.creamDark }}>×</button>
        </div>

        {step === "RECEIPT" && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Fotografa lo scontrino: segno io cosa hai comprato. Oppure verifica a mano.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setStep("ANALYZING");
                void scan.scan(file);
              }}
            />
            <Button className="w-full" onClick={() => fileRef.current?.click()}>📷 Fotografa lo scontrino</Button>
            <Button className="w-full" variant="secondary" onClick={() => setStep("REVIEW")}>Verifica manualmente senza scontrino</Button>
          </div>
        )}

        {step === "ANALYZING" && (
          <div className="py-10 text-center space-y-4">
            <div className="w-10 h-10 mx-auto rounded-full animate-spin" style={{ border: `3px solid ${colors.creamDark}`, borderTopColor: colors.terracotta }} />
            <p className="text-sm" style={{ color: colors.inkMuted }}>Leggo lo scontrino… {scan.model.progress > 0 ? `${scan.model.progress}%` : ""}</p>
          </div>
        )}

        {step === "REVIEW" && (
          <div className="space-y-4">
            {noticeByState[scan.model.state] && (
              <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>
                {noticeByState[scan.model.state]}
              </p>
            )}
            {scan.model.state === "READY" && (
              <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>
                Ho riconosciuto {scan.lines.length} prodotti. Controlla e correggi prima di confermare.
              </p>
            )}

            {items.length > 0 && (
              <RowList>
                {items.map((item, i) => {
                  const bought = purchased.has(item.id);
                  return (
                    <Row key={item.id} index={i} last={i === items.length - 1}>
                      <button
                        onClick={() => toggle(item.id)}
                        aria-pressed={bought}
                        aria-label={`${item.displayName}: ${bought ? "acquistato" : "non acquistato"}`}
                        className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 text-xs"
                        style={{ borderColor: bought ? colors.sage : colors.border, backgroundColor: bought ? colors.sage : "transparent", color: colors.white }}
                      >
                        {bought ? "✓" : ""}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: bought ? colors.ink : colors.inkMuted }}>{item.displayName}</p>
                        <p className="text-[11px]" style={{ color: colors.inkMuted }}>{formatQuantity(item.quantity)} {formatUnit(item.unit)}</p>
                      </div>
                      {bought && (
                        <Button size="sm" variant="ghost" onClick={() => toggle(item.id)}>Non preso</Button>
                      )}
                    </Row>
                  );
                })}
              </RowList>
            )}

            {extras.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold" style={{ color: colors.inkMuted }}>Altri acquisti</p>
                <RowList>
                  {extras.map((extra, i) => (
                    <Row key={extra.id} index={i} last={i === extras.length - 1}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: colors.ink }}>{extra.name}</p>
                        <p className="text-[11px]" style={{ color: colors.inkMuted }}>{formatQuantity(extra.quantity)} {formatUnit(extra.unit)}</p>
                      </div>
                      <Button size="sm" variant="ghost" aria-label={`Rimuovi ${extra.name}`} onClick={() => setExtras((c) => c.filter((x) => x.id !== extra.id))}>×</Button>
                    </Row>
                  ))}
                </RowList>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold" style={{ color: colors.inkMuted }}>Aggiungi un acquisto non presente nella lista</p>
              <ProductSearch
                placeholder="Cerca un prodotto (es. latte, pasta…)"
                onSelect={addProductFromSearch}
                onAddFreeText={addExtra}
                emptyActionLabel="Aggiungi la ricerca come voce libera"
              />
              <p className="text-[11px]" style={{ color: colors.inkMuted }}>
                Tocca direttamente un'anteprima per aggiungerla: se ha una confezione nota, viene caricata con la quantità fisica della confezione.
              </p>
            </div>

            <div className="rounded-xl px-4 py-3 text-xs" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
              <strong style={{ color: colors.ink }}>{plan.inPantryCount}</strong> prodotti vanno in dispensa ·{" "}
              <strong style={{ color: colors.ink }}>{plan.staysInListCount}</strong> restano in lista
            </div>

            {error && <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>{error}</p>}

            <div className="flex gap-3">
              {scan.draftId || scan.model.state !== "IDLE" ? (
                <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => void changeReceipt()}>Cambia scontrino</Button>
              ) : (
                <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => setStep("RECEIPT")}>Indietro</Button>
              )}
              <Button className="flex-1" loading={submitting} disabled={!canCompleteCheckout(plan)} onClick={() => void submit()}>
                Conferma e aggiorna dispensa
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
