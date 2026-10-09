import { useEffect, useMemo, useState } from "react";
import type { ShoppingItem } from "../../types";
import type { ProductDto } from "../../api/types";
import * as api from "../../api/endpoints";
import { isBackendUnreachable } from "../../api/client";
import type { PickerTab, UseShoppingSuggestionsResult } from "../../hooks/useShoppingSuggestions";
import { formatQuantity, formatUnit } from "../../domain/units";
import { isAlreadyListed, type ShoppingSuggestion } from "../../domain/shopping-suggestions";
import { colors, fonts } from "../../tokens";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import { Row, RowList } from "../ui/ListRow";
import ProductDetail from "./ProductDetail";

interface Props {
  tab: PickerTab;
  onTab: (tab: PickerTab) => void;
  onClose: () => void;
  suggestions: UseShoppingSuggestionsResult;
  listItems: ShoppingItem[];
  onAddSuggestion: (suggestion: ShoppingSuggestion) => void;
  onAddRecipeAll: (recipeId: string, title: string) => Promise<void>;
  onAddCustom: (name: string) => void;
  onAddProduct: (product: ProductDto, quantity: number) => void;
}

const TABS: ReadonlyArray<{ key: PickerTab; label: string }> = [
  { key: "REORDER", label: "Scorte" },
  { key: "RECIPE", label: "Ricette" },
  { key: "OFFER", label: "Offerte" },
  { key: "SEARCH", label: "Cerca" },
];

type SearchResult = Awaited<ReturnType<typeof api.searchCatalogProducts>>["items"][number];

export default function ShoppingPicker(props: Props) {
  const { tab, onTab, onClose, suggestions, listItems } = props;
  const [detail, setDetail] = useState<ProductDto | null>(null);

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      {detail ? (
        <ProductDetail
          product={detail}
          alreadyListed={isAlreadyListed(listItems, { productId: detail.id, label: detail.canonicalName })}
          onBack={() => setDetail(null)}
          onAdd={(quantity) => {
            props.onAddProduct(detail, quantity);
            setDetail(null);
          }}
        />
      ) : (
        <div className="p-4 space-y-4 sm:p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Aggiungi alla spesa</h3>
            <button onClick={onClose} aria-label="Chiudi" className="w-8 h-8 rounded-full" style={{ backgroundColor: colors.creamDark }}>×</button>
          </div>

          <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: colors.creamDark }} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => onTab(t.key)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold"
                style={{ backgroundColor: tab === t.key ? colors.white : "transparent", color: tab === t.key ? colors.ink : colors.inkMuted }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "REORDER" && (
            <SuggestionList
              items={suggestions.reorder}
              empty={{ icon: "📦", title: "Nessuna scorta in esaurimento", description: "Quando un prodotto scende sotto la sua soglia, lo trovi qui." }}
              onAdd={props.onAddSuggestion}
            />
          )}
          {tab === "RECIPE" && (
            <SuggestionList
              items={suggestions.recipe}
              loading={suggestions.loading.RECIPE}
              error={suggestions.error.RECIPE}
              groupAction={(s) => (s.sourceRef ? { label: "Aggiungi tutti", run: () => props.onAddRecipeAll(s.sourceRef as string, s.group ?? "") } : undefined)}
              empty={{ icon: "🍳", title: "Nessun ingrediente mancante", description: "Hai già tutto per le ricette suggerite." }}
              onAdd={props.onAddSuggestion}
            />
          )}
          {tab === "OFFER" && (
            <SuggestionList
              items={suggestions.offer}
              loading={suggestions.loading.OFFER}
              error={suggestions.error.OFFER}
              empty={{ icon: "🏷️", title: "Nessuna offerta attiva", description: "Le offerte dei tuoi negozi compariranno qui." }}
              onAdd={props.onAddSuggestion}
            />
          )}
          {tab === "SEARCH" && (
            <SearchTab
              onAddCustom={props.onAddCustom}
              onAddProduct={props.onAddProduct}
              onOpenDetail={setDetail}
              listItems={listItems}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function SuggestionList({
  items,
  loading,
  error,
  empty,
  onAdd,
  groupAction,
}: {
  items: ShoppingSuggestion[];
  loading?: boolean;
  error?: string | null;
  empty: { icon: string; title: string; description: string };
  onAdd: (s: ShoppingSuggestion) => void;
  groupAction?: (first: ShoppingSuggestion) => { label: string; run: () => Promise<void> } | undefined;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, ShoppingSuggestion[]>();
    for (const item of items) {
      const key = item.group ?? "";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  if (loading) return <p className="text-sm text-center py-8" style={{ color: colors.inkMuted }}>Carico i suggerimenti…</p>;
  if (error) return <EmptyState icon="⚠️" title="Suggerimenti non disponibili" description={error} variant="warning" />;
  if (items.length === 0) return <EmptyState {...empty} />;

  return (
    <div className="space-y-4">
      {groups.map(([group, rows]) => {
        const action = groupAction?.(rows[0] as ShoppingSuggestion);
        return (
          <div key={group || "all"} className="space-y-2">
            {group && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: colors.inkMuted }}>{group}</p>
                {action && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === group}
                    onClick={async () => {
                      setBusy(group);
                      try { await action.run(); } finally { setBusy(null); }
                    }}
                  >
                    {action.label}
                  </Button>
                )}
              </div>
            )}
            <RowList>
              {rows.map((s, i) => (
                <Row key={s.key} index={i} last={i === rows.length - 1}>
                  {s.imageUrl ? (
                    <img
                      src={s.imageUrl}
                      alt=""
                      loading="lazy"
                      className="w-12 h-12 rounded-lg object-contain bg-white border shrink-0"
                    />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: colors.cream }}
                    >
                      🍽️
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: colors.ink }}>{s.label}</p>
                    <p className="text-[11px] truncate" style={{ color: colors.inkMuted }}>
                      {[s.brand, s.packageLabel].filter(Boolean).join(" · ") || "Dettagli"}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: colors.inkMuted }}>
                      {formatQuantity(s.quantity)} {formatUnit(s.unit)} · {s.reason}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => onAdd(s)}>Aggiungi</Button>
                </Row>
              ))}
            </RowList>
          </div>
        );
      })}
    </div>
  );
}

function SearchTab({
  onAddCustom,
  onAddProduct,
  onOpenDetail,
  listItems,
}: {
  onAddCustom: (name: string) => void;
  onAddProduct: (product: ProductDto, quantity: number) => void;
  onOpenDetail: (product: ProductDto) => void;
  listItems: ShoppingItem[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const trimmed = query.trim();

  // Same contract as the pantry search: >= 3 chars, 300 ms debounce, abortable.
  useEffect(() => {
    if (trimmed.length < 3) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.searchCatalogProducts(trimmed, 8, controller.signal);
        if (!controller.signal.aborted) setResults(result.items);
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(isBackendUnreachable(err) ? "Impossibile contattare il server." : "La ricerca prodotto non è disponibile in questo momento.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  // Selecting reuses the barcode path: the full record is resolved/persisted in Catalog and we get
  // the Catalog product id that Shopping stores on the item.
  async function resolve(item: SearchResult): Promise<ProductDto | null> {
    setResolving(item.code);
    setError(null);
    try {
      const resolved = await api.resolveProductBarcode("BARCODE", item.code);
      if (resolved.status === "MATCHED" && resolved.product) return resolved.product;
      setError("Il prodotto selezionato non è più disponibile.");
    } catch (err) {
      setError(isBackendUnreachable(err) ? "Impossibile contattare il server." : "Non è stato possibile caricare il prodotto.");
    } finally {
      setResolving(null);
    }
    return null;
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Cerca un prodotto (es. latte, pasta…)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        hint={trimmed.length > 0 && trimmed.length < 3 ? "Inserisci almeno 3 caratteri." : undefined}
      />

      {loading && <p className="text-xs text-center py-3" style={{ color: colors.inkMuted }}>Cerco tra i prodotti…</p>}
      {error && <p className="text-xs rounded-xl px-3 py-2" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>{error}</p>}

      {!loading && results.length > 0 && (
        <RowList>
          {results.map((item, i) => {
            const listed = isAlreadyListed(listItems, { label: item.name });
            return (
              <Row key={item.code} index={i} last={i === results.length - 1}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-contain bg-white border shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: colors.cream }}>🍽️</div>
                )}
                <button
                  className="flex-1 min-w-0 text-left"
                  disabled={resolving !== null}
                  onClick={async () => { const p = await resolve(item); if (p) onOpenDetail(p); }}
                >
                  <p className="text-sm font-medium truncate" style={{ color: colors.ink }}>{item.name}</p>
                  <p className="text-[11px] truncate" style={{ color: colors.inkMuted }}>
                    {[item.brand, item.packageLabel].filter(Boolean).join(" · ") || "Dettagli"}
                  </p>
                </button>
                <Button
                  size="sm"
                  disabled={listed || resolving !== null}
                  loading={resolving === item.code}
                  aria-label={`Aggiungi ${item.name}`}
                  onClick={async () => { const p = await resolve(item); if (p) onAddProduct(p, 1); }}
                >
                  {listed ? "In lista" : "+"}
                </Button>
              </Row>
            );
          })}
        </RowList>
      )}

      {trimmed.length >= 3 && !loading && (
        <Button className="w-full" variant="secondary" onClick={() => onAddCustom(trimmed)}>
          Aggiungi «{trimmed}» come voce libera
        </Button>
      )}
    </div>
  );
}
