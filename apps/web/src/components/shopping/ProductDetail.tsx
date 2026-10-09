import { useState } from "react";
import type { ProductDto } from "../../api/types";
import { colors } from "../../tokens";
import Button from "../ui/Button";
import { Input } from "../ui/Input";

interface Props {
  product: ProductDto;
  alreadyListed: boolean;
  onBack: () => void;
  onAdd: (quantity: number) => void;
}

function text(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function tags(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.replace(/^\w+:/, "").replaceAll("-", " "))
    : [];
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: colors.cream }}>
      <p className="text-[10px]" style={{ color: colors.inkMuted }}>{label}</p>
      <p className="text-xs font-medium mt-0.5 break-words" style={{ color: colors.ink }}>{value}</p>
    </div>
  );
}

const nutrient = (label: string, value: number | undefined, unit: string) =>
  value !== undefined && value !== null ? { label, value: `${value} ${unit}` } : null;

/** Product detail from Catalog (Open Food Facts data), shown before adding it to the list. */
export default function ProductDetail({ product, alreadyListed, onBack, onAdd }: Props) {
  const [qty, setQty] = useState("1");
  const raw = product.openFoodFacts ?? {};
  const image = product.images?.front ?? product.photoUrl;
  const ingredients = text(raw, "ingredients_text_it") ?? text(raw, "ingredients_text");
  const origin = text(raw, "origins") ?? tags(raw, "countries_tags").join(", ");
  const allergens = tags(raw, "allergens_tags");
  const nutrition = [
    nutrient("Energia", product.calories, "kcal"),
    nutrient("Proteine", product.protein, "g"),
    nutrient("Carboidrati", product.carbs, "g"),
    nutrient("Grassi", product.fat, "g"),
    nutrient("Fibre", product.fiber, "g"),
  ].filter((n): n is { label: string; value: string } => n !== null);

  const quantity = Number(qty.replace(",", "."));
  const valid = Number.isFinite(quantity) && quantity > 0;
  const packageDescription = product.quantityLabel
    ?? (product.quantityValue != null && product.quantityUnit ? String(product.quantityValue) + " " + product.quantityUnit : undefined);

  return (
    <div className="p-4 space-y-4 sm:p-6">
      <button onClick={onBack} className="text-sm" style={{ color: colors.inkMuted }}>← Indietro</button>

      <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: colors.white, border: `1px solid ${colors.border}` }}>
        {image && <img src={image} alt={product.canonicalName} className="w-full max-h-56 rounded-xl object-contain bg-white" />}
        <div>
          <p className="text-lg font-semibold" style={{ color: colors.ink }}>{product.canonicalName}</p>
          {product.brand && <p className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>{product.brand}</p>}
          <p className="text-[11px] mt-1" style={{ color: colors.inkMuted }}>
            Fonte: {product.provenanceQuality === "VERIFIED" ? "catalogo locale" : "Open Food Facts"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Cell label="Confezione" value={product.quantityLabel ?? "—"} />
          <Cell label="Categoria" value={product.category ?? "—"} />
          {origin && <Cell label="Origine" value={origin} />}
          {allergens.length > 0 && <Cell label="Allergeni" value={allergens.join(", ")} />}
        </div>

        {ingredients && (
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: colors.inkMuted }}>Ingredienti</p>
            <p className="text-xs leading-relaxed" style={{ color: colors.ink }}>{ingredients}</p>
          </div>
        )}

        {nutrition.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: colors.inkMuted }}>Valori nutrizionali (per 100 g)</p>
            <div className="grid grid-cols-3 gap-2">
              {nutrition.map((n) => <Cell key={n.label} label={n.label} value={n.value} />)}
            </div>
          </div>
        )}
      </div>

      <Input label="Quantità (confezioni)" type="number" inputMode="decimal" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      {packageDescription && (
        <p className="text-[11px]" style={{ color: colors.inkMuted }}>
          1 confezione = {packageDescription}. Alla conferma verrà caricata in dispensa la quantità fisica della confezione.
        </p>
      )}
      {alreadyListed && (
        <p className="text-xs" style={{ color: colors.amberDark }}>Questo prodotto è già nella lista.</p>
      )}
      <Button className="w-full" disabled={!valid || alreadyListed} onClick={() => onAdd(quantity)}>
        Aggiungi alla spesa
      </Button>
    </div>
  );
}
