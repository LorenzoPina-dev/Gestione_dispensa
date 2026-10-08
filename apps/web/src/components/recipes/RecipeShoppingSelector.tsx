
import { useEffect, useMemo, useState } from "react";
import type { ProductDto } from "../../api/types";
import * as api from "../../api/endpoints";
import { isBackendUnreachable, isNotFound } from "../../api/client";
import { colors, fonts } from "../../tokens";
import { Input } from "../ui/Input";
import Button from "../ui/Button";

interface Props {
  familyId: string;
  recipeTitle: string;
  missingIngredients: string[];
  onClose: () => void;
  onComplete: (count: number) => Promise<void>;
}

type SearchResult = Awaited<ReturnType<typeof api.searchCatalogProducts>>["items"][number];

function purchaseQuantity(product: ProductDto, packageCount: number): { quantity: number; unit: ProductDto["defaultUnit"] | "pack" } {
  const value = product.quantityValue;
  const rawUnit = product.quantityUnit?.trim();
  if (value != null && Number.isFinite(value) && value > 0 && rawUnit) {
    const unit = rawUnit === "g" || rawUnit === "kg" || rawUnit === "ml" || rawUnit === "l" || rawUnit === "piece" || rawUnit === "pack"
      ? rawUnit
      : "pack";
    return { quantity: Math.round(value * packageCount * 1000) / 1000, unit };
  }
  return { quantity: packageCount, unit: "pack" };
}

function ProductChoice({
  ingredient,
  selected,
  onSelect,
}: {
  ingredient: string;
  selected: ProductDto | undefined;
  onSelect: (product: ProductDto) => void;
}) {
  const [query, setQuery] = useState(ingredient);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.searchCatalogProducts(value, 8, controller.signal);
        if (!controller.signal.aborted) setResults(result.items);
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(isBackendUnreachable(err) ? "Server non raggiungibile." : "Ricerca prodotto non disponibile.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  async function choose(result: SearchResult): Promise<void> {
    setResolving(result.code);
    setError(null);
    try {
      const resolved = await api.resolveProductBarcode("BARCODE", result.code);
      if (resolved.status === "MATCHED" && resolved.product) {
        onSelect(resolved.product);
      } else {
        setError("Il prodotto selezionato non è più disponibile.");
      }
    } catch (err) {
      setError(isBackendUnreachable(err) ? "Server non raggiungibile." : "Impossibile caricare il prodotto.");
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: colors.white, border: "1px solid " + colors.border }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: colors.ink }}>{ingredient}</p>
          <p className="text-[11px] mt-0.5" style={{ color: colors.inkMuted }}>
            {selected ? "Scelto: " + selected.canonicalName : "Cerca e scegli il prodotto da acquistare."}
          </p>
        </div>
        {selected && <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>✓ Scelto</span>}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={"Cerca " + ingredient + "…"}
      />

      {loading && <p className="text-xs py-2 text-center" style={{ color: colors.inkMuted }}>Cerco prodotti…</p>}
      {error && <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>{error}</p>}

      {!loading && results.length > 0 && (
        <div className="space-y-1">
          {results.map((result) => (
            <button
              key={result.code}
              type="button"
              disabled={resolving !== null}
              onClick={() => void choose(result)}
              className="w-full flex items-center gap-3 rounded-xl p-2 text-left"
              style={{ backgroundColor: colors.creamMid }}
            >
              {result.imageUrl ? (
                <img src={result.imageUrl} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-contain bg-white border shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: colors.white }}>🍽️</div>
              )}
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate" style={{ color: colors.ink }}>{result.name}</span>
                <span className="block text-[11px] truncate" style={{ color: colors.inkMuted }}>
                  {[result.brand, result.packageLabel].filter(Boolean).join(" · ") || "Dettagli prodotto"}
                </span>
              </span>
              <span className="text-xs font-semibold" style={{ color: colors.terracotta }}>
                {resolving === result.code ? "…" : "Scegli"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="rounded-xl p-3" style={{ backgroundColor: colors.cream }}>
          <div className="flex items-center gap-3">
            {selected.images?.front ?? selected.photoUrl ? (
              <img
                src={selected.images?.front ?? selected.photoUrl}
                alt=""
                className="w-14 h-14 rounded-lg object-contain bg-white border shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg flex items-center justify-center shrink-0 bg-white">🍽️</div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: colors.ink }}>{selected.canonicalName}</p>
              {selected.brand && <p className="text-[11px]" style={{ color: colors.inkMuted }}>{selected.brand}</p>}
              <p className="text-[11px] mt-1" style={{ color: colors.inkMuted }}>
                {selected.quantityLabel ?? "Quantità confezione non disponibile"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecipeShoppingSelector({ familyId, recipeTitle, missingIngredients, onClose, onComplete }: Props) {
  const entries = useMemo(
    () => missingIngredients.map((name, index) => ({ key: String(index) + ":" + name, name })),
    [missingIngredients],
  );
  const [selected, setSelected] = useState<Record<string, ProductDto>>({});
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function choose(key: string, product: ProductDto): void {
    setSelected((current) => ({ ...current, [key]: product }));
    setCounts((current) => ({ ...current, [key]: current[key] ?? "1" }));
    setMessage(null);
  }

  async function addSelected(): Promise<void> {
    const chosen = entries.filter((entry) => selected[entry.key]);
    if (chosen.length === 0) return;

    setBusy(true);
    setMessage(null);
    try {
      let active;
      try {
        active = await api.getActiveShoppingList(familyId);
      } catch (err) {
        if (!isNotFound(err)) throw err;
        const created = await api.createShoppingList(familyId, "Spesa settimanale");
        active = { list: { listId: created.id, name: created.name, status: "open" as const, version: created.version }, items: [] };
      }

      const listedProducts = new Set(
        active.items.map((item) => item.productId).filter((id): id is string => Boolean(id)),
      );
      let added = 0;

      for (const entry of chosen) {
        const product = selected[entry.key];
        const count = Number((counts[entry.key] ?? "1").replace(",", "."));
        if (!Number.isFinite(count) || count <= 0) continue;
        if (listedProducts.has(product.id)) continue;

        const purchase = purchaseQuantity(product, count);
        await api.addShoppingItem(familyId, active.list.listId, {
          displayName: product.canonicalName,
          quantity: purchase.quantity,
          unit: purchase.unit,
          productId: product.id,
          sourceType: "RECIPE",
          sourceRef: recipeTitle,
          idempotencyKey: "recipe-shopping:" + familyId + ":" + entry.key + ":" + product.id,
        });
        listedProducts.add(product.id);
        added += 1;
      }

      if (added === 0) {
        setMessage("Nessun nuovo prodotto aggiunto: i prodotti scelti sono già nella lista o hanno una quantità non valida.");
        return;
      }

      await onComplete(added);
    } catch (err) {
      setMessage(isBackendUnreachable(err) ? "Server non raggiungibile." : (err instanceof Error ? err.message : "Impossibile aggiornare la lista della spesa."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Torna alla ricetta"
          className="w-10 h-10 shrink-0 rounded-full text-lg"
          style={{ backgroundColor: colors.white, border: "1px solid " + colors.border, color: colors.ink }}
        >
          ←
        </button>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.inkMuted }}>Aggiungi alla spesa</p>
          <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>{recipeTitle}</h2>
        </div>
      </div>

      <p className="text-xs" style={{ color: colors.inkMuted }}>
        Scegli quali ingredienti vuoi davvero acquistare e, per ciascuno, seleziona il prodotto corretto.
      </p>

      <div className="space-y-3">
        {entries.map((entry) => (
          <ProductChoice
            key={entry.key}
            ingredient={entry.name}
            selected={selected[entry.key]}
            onSelect={(product) => choose(entry.key, product)}
          />
        ))}
      </div>

      {Object.keys(selected).length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ backgroundColor: colors.creamDark, border: "1px solid " + colors.border }}>
          <p className="text-xs font-semibold" style={{ color: colors.ink }}>Quantità da acquistare</p>
          {entries.filter((entry) => selected[entry.key]).map((entry) => {
            const product = selected[entry.key];
            return (
              <div key={entry.key} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ backgroundColor: colors.white }}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" style={{ color: colors.ink }}>{product.canonicalName}</p>
                  <p className="text-[10px] truncate" style={{ color: colors.inkMuted }}>Per: {entry.name}</p>
                </div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={counts[entry.key] ?? "1"}
                  onChange={(e) => setCounts((current) => ({ ...current, [entry.key]: e.target.value }))}
                  className="w-20 rounded-lg px-2 py-1.5 text-sm text-center outline-none"
                  style={{ border: "1px solid " + colors.border, backgroundColor: colors.cream, color: colors.ink }}
                  aria-label={"Numero confezioni di " + product.canonicalName}
                />
                <span className="text-[10px]" style={{ color: colors.inkMuted }}>conf.</span>
              </div>
            );
          })}
        </div>
      )}

      {message && <p className="rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>{message}</p>}

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>Annulla</Button>
        <Button className="flex-1" onClick={() => void addSelected()} disabled={Object.keys(selected).length === 0 || busy} loading={busy}>
          Aggiungi selezionati ({Object.keys(selected).length})
        </Button>
      </div>
    </div>
  );
}
