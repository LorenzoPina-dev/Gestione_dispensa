/**
 * Builds the Open Food Facts API-shaped view used by Catalog resolve responses.
 *
 * Mongo keeps the persisted OFF document, where image URLs may be absent and only image metadata
 * (selected/uploaded image ids, revisions and sizes) is stored. The UI must never have to know
 * how OFF image paths are reconstructed, so this adapter derives the public image URL fields here.
 */
export interface OffApiViewImages {
  image_front_url: string | null;
  image_front_small_url: string | null;
  image_front_thumb_url: string | null;
  image_ingredients_url: string | null;
  image_ingredients_small_url: string | null;
  image_ingredients_thumb_url: string | null;
  image_nutrition_url: string | null;
  image_nutrition_small_url: string | null;
  image_nutrition_thumb_url: string | null;
  image_packaging_url: string | null;
  image_packaging_small_url: string | null;
  image_packaging_thumb_url: string | null;
  image_url: string | null;
  image_small_url: string | null;
  image_thumb_url: string | null;
}

export interface OffApiViewResult {
  product: Record<string, unknown>;
  images: OffApiViewImages;
}

const DEFAULT_IMAGES_BASE_URL = "https://images.openfoodfacts.org/images/products";
const KINDS = ["front", "ingredients", "nutrition", "packaging"] as const;

type Kind = typeof KINDS[number];
type ImageMeta = {
  key: string;
  revision: string;
  imageId: string | null;
  sizes: Set<number>;
  hasFull: boolean;
};

const SIZE_PREFERENCE = {
  thumb: [100, 200],
  small: [200, 400],
  display: [400, 200],
} as const;

export function toOffApiView(
  code: string,
  source: Record<string, unknown> | null | undefined,
  imagesBaseUrl = DEFAULT_IMAGES_BASE_URL,
): OffApiViewResult | null {
  if (!source) return null;

  const normalizedCode = code.trim();
  if (!/^\d{4,24}$/.test(normalizedCode)) return null;

  const current = { ...source };
  const rawImages = isRecord(source.images) ? source.images : undefined;
  const selected = isRecord(rawImages?.selected) ? rawImages.selected : undefined;
  const legacySelected = isRecord(source.selected_images) ? source.selected_images : undefined;
  const languageOrder = buildLanguageOrder(source);

  const derived: Partial<OffApiViewImages> = {};

  for (const kind of KINDS) {
    const resolved = resolveKindImage(source, rawImages, selected, legacySelected, kind, languageOrder);
    const display = firstHttp(
      getString(current, `image_${kind}_url`),
      resolved ? makeImageUrl(normalizedCode, resolved, "display", imagesBaseUrl) : null,
      storedSelectedUrl(legacySelected, kind, "display", languageOrder),
    );
    const small = firstHttp(
      getString(current, `image_${kind}_small_url`),
      resolved ? makeImageUrl(normalizedCode, resolved, "small", imagesBaseUrl) : null,
      storedSelectedUrl(legacySelected, kind, "small", languageOrder),
    );
    const thumb = firstHttp(
      getString(current, `image_${kind}_thumb_url`),
      resolved ? makeImageUrl(normalizedCode, resolved, "thumb", imagesBaseUrl) : null,
      storedSelectedUrl(legacySelected, kind, "thumb", languageOrder),
    );

    derived[`image_${kind}_url` as keyof OffApiViewImages] = display;
    derived[`image_${kind}_small_url` as keyof OffApiViewImages] = small;
    derived[`image_${kind}_thumb_url` as keyof OffApiViewImages] = thumb;
  }

  derived.image_url = derived.image_front_url ?? getString(current, "image_url") ?? null;
  derived.image_small_url = derived.image_front_small_url ?? getString(current, "image_small_url") ?? null;
  derived.image_thumb_url = derived.image_front_thumb_url ?? getString(current, "image_thumb_url") ?? null;

  const product: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(derived)) {
    if (value !== null) product[key] = value;
  }
  delete product._cache_meta;

  return {
    product,
    images: {
      image_front_url: (derived.image_front_url ?? null),
      image_front_small_url: (derived.image_front_small_url ?? null),
      image_front_thumb_url: (derived.image_front_thumb_url ?? null),
      image_ingredients_url: (derived.image_ingredients_url ?? null),
      image_ingredients_small_url: (derived.image_ingredients_small_url ?? null),
      image_ingredients_thumb_url: (derived.image_ingredients_thumb_url ?? null),
      image_nutrition_url: (derived.image_nutrition_url ?? null),
      image_nutrition_small_url: (derived.image_nutrition_small_url ?? null),
      image_nutrition_thumb_url: (derived.image_nutrition_thumb_url ?? null),
      image_packaging_url: (derived.image_packaging_url ?? null),
      image_packaging_small_url: (derived.image_packaging_small_url ?? null),
      image_packaging_thumb_url: (derived.image_packaging_thumb_url ?? null),
      image_url: (derived.image_url ?? null),
      image_small_url: (derived.image_small_url ?? null),
      image_thumb_url: (derived.image_thumb_url ?? null),
    },
  };
}

function resolveKindImage(
  source: Record<string, unknown>,
  rawImages: Record<string, unknown> | undefined,
  selected: Record<string, unknown> | undefined,
  legacySelected: Record<string, unknown> | undefined,
  kind: Kind,
  languageOrder: readonly string[],
): ImageMeta | null {
  const byLanguage = new Map<string, ImageMeta>();
  const keyPattern = new RegExp(`^${kind}(?:_([a-z]{2,3}(?:[-_][a-z0-9]+)?))?$`, "i");

  for (const [key, value] of Object.entries(rawImages ?? {})) {
    const match = keyPattern.exec(key);
    const meta = isRecord(value) ? value : undefined;
    if (!match || !meta) continue;
    const revision = scalar(meta.rev);
    if (!revision) continue;
    const parsed = parseSizes(isRecord(meta.sizes) ? meta.sizes : undefined);
    byLanguage.set((match[1] ?? "").toLowerCase(), {
      key,
      revision,
      imageId: scalar(meta.imgid),
      ...parsed,
    });
  }

  for (const candidate of [isRecord(selected?.[kind]) ? selected?.[kind] : undefined,
    isRecord(legacySelected?.[kind]) ? legacySelected?.[kind] : undefined]) {
    if (!candidate) continue;
    for (const [language, value] of Object.entries(candidate)) {
      if (language === "display" || language === "small" || language === "thumb") continue;
      const meta = isRecord(value) ? value : undefined;
      const revision = meta ? scalar(meta.rev) : null;
      if (!meta || !revision) continue;
      const imageId = scalar(meta.imgid);
      const uploaded = imageId && isRecord(rawImages?.uploaded)
        ? rawImages.uploaded[imageId]
        : undefined;
      const sizes = isRecord(meta.sizes)
        ? meta.sizes
        : isRecord(uploaded) && isRecord(uploaded.sizes)
          ? uploaded.sizes
          : undefined;
      byLanguage.set(language.toLowerCase(), {
        key: `${kind}_${language.toLowerCase()}`,
        revision,
        imageId,
        ...parseSizes(sizes),
      });
    }
  }

  const sourceLang = primaryLanguage(
    firstString(source.product_name_it ? "it" : null, source.lang, source.lc),
  );
  const order = unique([...languageOrder, ...(sourceLang ? [sourceLang] : [])]);
  for (const language of order) {
    const hit = byLanguage.get(language);
    if (hit) return hit;
  }

  const plain = byLanguage.get("");
  if (plain) return plain;

  const first = [...byLanguage.keys()].sort()[0];
  return first ? byLanguage.get(first) ?? null : null;
}

function makeImageUrl(
  code: string,
  image: ImageMeta,
  sizeName: "thumb" | "small" | "display",
  imagesBaseUrl: string,
): string | null {
  const path = productImagePath(code);
  if (!path) return null;

  let size: number | "full" | null = null;
  for (const candidate of SIZE_PREFERENCE[sizeName]) {
    if (image.sizes.has(candidate)) {
      size = candidate;
      break;
    }
  }
  if (size === null && sizeName === "display" && image.hasFull) size = "full";
  if (size === null) return null;

  const file = `${encodeURIComponent(image.key)}.${image.revision}.${size}.jpg`;
  return `${imagesBaseUrl.replace(/\\/+$/, "")}/${path}/${file}`;
}

function productImagePath(code: string): string | null {
  const match = /^(\d{3})(\d{3})(\d{3})(\d*)$/.exec(code);
  if (!match) return code;
  return match[4]
    ? `${match[1]}/${match[2]}/${match[3]}/${match[4]}`
    : `${match[1]}/${match[2]}/${match[3]}`;
}

function storedSelectedUrl(
  selectedImages: Record<string, unknown> | undefined,
  kind: Kind,
  sizeName: "display" | "small" | "thumb",
  order: readonly string[],
): string | null {
  const bySize = isRecord(selectedImages?.[kind]) ? selectedImages?.[kind] : undefined;
  const values = isRecord(bySize?.[sizeName]) ? bySize?.[sizeName] : undefined;
  if (!values) return null;
  const byLang = new Map<string, string>();
  for (const [lang, value] of Object.entries(values)) {
    if (isHttp(value)) byLang.set(lang.toLowerCase(), value.trim());
  }
  for (const lang of order) {
    const hit = byLang.get(lang);
    if (hit) return hit;
  }
  return [...byLang.keys()].sort().map((lang) => byLang.get(lang)!).find(Boolean) ?? null;
}

function buildLanguageOrder(source: Record<string, unknown>): string[] {
  const candidates = ["it", "en"];
  const lang = primaryLanguage(firstString(source.lang, source.lc));
  if (lang) candidates.push(lang);
  return unique(candidates);
}

function primaryLanguage(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(normalized) ? normalized : null;
}

function parseSizes(
  sizes: Record<string, unknown> | undefined,
): { sizes: Set<number>; hasFull: boolean } {
  if (!sizes) return { sizes: new Set([100, 200, 400]), hasFull: true };
  return {
    sizes: new Set(Object.keys(sizes).map(Number).filter((n) => Number.isInteger(n) && n > 0)),
    hasFull: Object.hasOwn(sizes, "full"),
  };
}

function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function getString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstHttp(...values: Array<string | null>): string | null {
  return values.find((value) => value !== null && isHttp(value)) ?? null;
}

function isHttp(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/\\S+$/i.test(value.trim());
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
