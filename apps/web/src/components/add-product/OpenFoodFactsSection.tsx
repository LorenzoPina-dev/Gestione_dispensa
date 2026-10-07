import type { Candidate } from "./model";

export function OpenFoodFactsSection({ raw, images }: { raw: Record<string, unknown>; images: GalleryImage[] }) {
  const stringValue = (key: string) => typeof raw[key] === "string" ? raw[key] as string : undefined;
  const arrayValue = (key: string) => Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((v): v is string => typeof v === "string") : [];

  const ingredients = stringValue("ingredients_text_it") ?? stringValue("ingredients_text");
  const allergens = arrayValue("allergens_tags");
  const traces = arrayValue("traces_tags");
  const labels = arrayValue("labels_tags");
  const categories = arrayValue("categories_tags");
  const countries = arrayValue("countries_tags");
  const stores = arrayValue("stores_tags");
  const packaging = stringValue("packaging_text") ?? stringValue("packaging");
  const nutriscore = stringValue("nutriscore_grade") ?? stringValue("nutrition_grades");
  const nova = raw.nova_group != null ? String(raw.nova_group) : undefined;
  const ecoscore = stringValue("ecoscore_grade");
  const origins = stringValue("origins");

  return (
    <div className="space-y-4">
      {images.length > 1 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Immagini disponibili</p>
          <div className="grid grid-cols-3 gap-2">
            {images.map(({ key, full, preview }) => (
              <a key={key} href={full} target="_blank" rel="noreferrer" className="block">
                <img src={preview} alt={key} loading="lazy" className="w-full h-24 rounded-lg object-cover bg-white border" />
                <span className="block text-[10px] mt-1 truncate" style={{ color: "#6b5e4e" }}>{humanizeOffKey(key)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {(ingredients || allergens.length || traces.length || labels.length || categories.length || countries.length || stores.length || packaging || nutriscore || nova || ecoscore || origins) && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: "#6b5e4e" }}>Informazioni prodotto</p>
          <div className="space-y-2">
            {ingredients && <InfoCell label="Ingredienti" value={ingredients} />}
            {packaging && <InfoCell label="Packaging" value={packaging} />}
            {origins && <InfoCell label="Origine" value={origins} />}
            {allergens.length > 0 && <InfoCell label="Allergeni" value={allergens.map(cleanTag).join(", ")} />}
            {traces.length > 0 && <InfoCell label="Tracce" value={traces.map(cleanTag).join(", ")} />}
            {labels.length > 0 && <InfoCell label="Etichette" value={labels.map(cleanTag).join(", ")} />}
            {categories.length > 0 && <InfoCell label="Categorie" value={categories.map(cleanTag).join(", ")} />}
            {countries.length > 0 && <InfoCell label="Paesi" value={countries.map(cleanTag).join(", ")} />}
            {stores.length > 0 && <InfoCell label="Negozi" value={stores.map(cleanTag).join(", ")} />}
            {nutriscore && <InfoCell label="Nutri-Score" value={nutriscore.toUpperCase()} />}
            {nova && <InfoCell label="NOVA" value={nova} />}
            {ecoscore && <InfoCell label="Eco-Score" value={ecoscore.toUpperCase()} />}
          </div>
        </div>
      )}

      <NutritionTable nutriments={isRecord(raw.nutriments) ? raw.nutriments : {}} />
    </div>
  );
}

function NutritionTable({ nutriments }: { nutriments: Record<string, unknown> }) {
  const rows: Array<{ label: string; keys: string[]; unit: string }> = [
    { label: "Energia", keys: ["energy-kcal_100g"], unit: "kcal" },
    { label: "Energia", keys: ["energy-kj_100g"], unit: "kJ" },
    { label: "Grassi", keys: ["fat_100g"], unit: "g" },
    { label: "di cui saturi", keys: ["saturated-fat_100g"], unit: "g" },
    { label: "Carboidrati", keys: ["carbohydrates_100g"], unit: "g" },
    { label: "di cui zuccheri", keys: ["sugars_100g"], unit: "g" },
    { label: "Fibre", keys: ["fiber_100g"], unit: "g" },
    { label: "Proteine", keys: ["proteins_100g"], unit: "g" },
    { label: "Sale", keys: ["salt_100g"], unit: "g" },
  ];

  const visible = rows.filter(({ keys }) =>
    keys.some((key) => nutriments[key] !== undefined && nutriments[key] !== null && nutriments[key] !== ""),
  );

  if (visible.length === 0) {
    return (
      <div className="rounded-xl px-3 py-3 text-xs" style={{ backgroundColor: "#f5f0e8", color: "#6b5e4e" }}>
        Valori nutrizionali non disponibili.
      </div>
    );
  }

  const seenEnergy = new Set<string>();
  const uniqueRows = visible.filter((row) => {
    if (row.label !== "Energia") return true;
    if (seenEnergy.has(row.label)) return false;
    seenEnergy.add(row.label);
    return true;
  });

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #d8cfc0", backgroundColor: "#fff" }}>
      <div className="px-4 py-3" style={{ backgroundColor: "#f5f0e8", borderBottom: "1px solid #d8cfc0" }}>
        <p className="text-xs font-semibold" style={{ color: "#1a1510" }}>Valori nutrizionali</p>
        <p className="text-[10px] mt-0.5" style={{ color: "#6b5e4e" }}>Valori indicativi per 100 g / 100 ml, quando disponibili.</p>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {uniqueRows.map(({ label, keys, unit }) => {
            const key = keys.find((candidate) => nutriments[candidate] !== undefined && nutriments[candidate] !== null && nutriments[candidate] !== "");
            if (!key) return null;
            const rawValue = nutriments[key];
            const value = typeof rawValue === "number"
              ? Number.isInteger(rawValue) ? String(rawValue) : rawValue.toFixed(2).replace(/0+$/, "").replace(/.$/, "")
              : String(rawValue);
            return (
              <tr key={key} style={{ borderTop: "1px solid #eee7dc" }}>
                <td className="px-4 py-2.5" style={{ color: "#4b4035" }}>{label}</td>
                <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "#1a1510" }}>{value} {unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: "#f5f0e8" }}>
      <p className="text-[10px]" style={{ color: "#6b5e4e" }}>{label}</p>
      <p className="text-xs font-medium mt-0.5 break-words" style={{ color: "#1a1510" }}>{value}</p>
    </div>
  );
}

export type GalleryImage = { key: string; full: string; preview: string };

const GALLERY_KINDS = ["front", "ingredients", "nutrition", "packaging"] as const;

/**
 * One entry per image kind instead of one per rendition: the catalog stores front/frontSmall/
 * frontThumb (and the same for the other kinds) but they are the same picture. The Small
 * rendition is used as the on-screen thumbnail, the full one as the link target.
 */
export function galleryImages(images: Candidate["images"]): GalleryImage[] {
  if (!images) return [];
  const pick = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
  const result: GalleryImage[] = [];
  for (const kind of GALLERY_KINDS) {
    const full = pick(images[kind]);
    const small = pick(images[`${kind}Small` as keyof typeof images]);
    const thumb = pick(images[`${kind}Thumb` as keyof typeof images]);
    const preview = small ?? thumb ?? full;
    if (!preview) continue;
    result.push({ key: kind, full: full ?? preview, preview });
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function humanizeOffKey(key: string): string {
  return key
    .replace(/_100g$/, " / 100 g")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatOffValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return JSON.stringify(value);
}

function cleanTag(value: string): string {
  return value.replace(/^\w+:/, "").replaceAll("-", " ");
}
