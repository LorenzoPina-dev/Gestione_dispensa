import { useEffect, useState } from "react";
import type { ProductDto, ProductSearchResultDto } from "../../api/types";
import * as api from "../../api/endpoints";
import { isBackendUnreachable } from "../../api/client";
import { colors } from "../../tokens";
import { Input } from "../ui/Input";
import { Row, RowList } from "../ui/ListRow";

export interface ProductSearchProps {
  onSelect: (product: ProductDto, barcode: string) => void | Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  emptyActionLabel?: string;
  onAddFreeText?: (value: string) => void;
}

export default function ProductSearch({
  onSelect,
  placeholder = "Cerca un prodotto (es. latte, pasta…)",
  autoFocus = false,
  emptyActionLabel,
  onAddFreeText,
}: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResultDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const trimmed = query.trim();

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
        setError(
          isBackendUnreachable(err)
            ? "Impossibile contattare il server."
            : "La ricerca prodotto non è disponibile in questo momento.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  async function resolve(item: ProductSearchResultDto): Promise<ProductDto | null> {
    setResolving(item.code);
    setError(null);
    try {
      const resolved = await api.resolveProductBarcode("BARCODE", item.code);
      if (resolved.status === "MATCHED" && resolved.product) return resolved.product;
      setError("Il prodotto selezionato non è più disponibile.");
    } catch (err) {
      setError(
        isBackendUnreachable(err)
          ? "Impossibile contattare il server."
          : "Non è stato possibile caricare il prodotto.",
      );
    } finally {
      setResolving(null);
    }
    return null;
  }

  async function select(item: ProductSearchResultDto) {
    if (resolving !== null) return;
    const product = await resolve(item);
    if (!product) return;
    await onSelect(product, item.code);
    setQuery("");
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={autoFocus}
        hint={trimmed.length > 0 && trimmed.length < 3 ? "Inserisci almeno 3 caratteri." : undefined}
      />

      {loading && (
        <p className="text-xs text-center py-3" style={{ color: colors.inkMuted }}>
          Cerco tra i prodotti…
        </p>
      )}
      {error && (
        <p
          className="text-xs rounded-xl px-3 py-2"
          style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}
        >
          {error}
        </p>
      )}

      {!loading && results.length > 0 && (
        <RowList>
          {results.map((item, i) => (
            <Row key={item.code} index={i} last={i === results.length - 1}>
              <button
                type="button"
                className="w-full flex items-center gap-3 text-left"
                disabled={resolving !== null}
                onClick={() => void select(item)}
                aria-label={`Seleziona ${item.name}`}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
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
                  <p className="text-sm font-medium truncate" style={{ color: colors.ink }}>
                    {item.name}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: colors.inkMuted }}>
                    {[item.brand, item.packageLabel].filter(Boolean).join(" · ") || "Dettagli"}
                  </p>
                </div>
                {resolving === item.code && (
                  <span className="text-[11px] shrink-0" style={{ color: colors.inkMuted }}>
                    Carico…
                  </span>
                )}
              </button>
            </Row>
          ))}
        </RowList>
      )}

      {trimmed.length >= 3 && !loading && onAddFreeText && (
        <button
          type="button"
          className="w-full text-left rounded-xl px-3 py-2 text-xs"
          style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
          onClick={() => {
            onAddFreeText(trimmed);
            setQuery("");
          }}
        >
          {emptyActionLabel ?? `Aggiungi «${trimmed}» come voce libera`}
        </button>
      )}
    </div>
  );
}
