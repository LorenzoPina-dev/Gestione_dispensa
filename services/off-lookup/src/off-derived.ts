/**
 * Derivation layer: turns the *persisted* representation of an Open Food Facts product (what is in
 * the MongoDB dump) into the fields the *API* would have produced.
 *
 * Why this exists: the dump stores image METADATA (`images.<key>.rev`, `sizes`, `imgid`) and
 * language-specific values (`product_name_xx`), while the API additionally exposes DERIVED fields
 * (`image_front_small_url`, a language-resolved name, ...). Those derived fields are
 * deterministic functions of the persisted data, so they can be computed locally without calling
 * the OFF API.
 *
 * Rules implemented here mirror Product Opener (Images.pm) as documented by Open Food Facts:
 *  - image folder:  barcode split as 3/3/3/rest when it has 9+ digits, the code itself otherwise;
 *  - selected image file:  <imagetype>_<lang>.<rev>.<size>.jpg   (size = 100 | 200 | 400 | full);
 *  - uploaded (not selected) image file:  <imgid>.jpg  /  <imgid>.<size>.jpg   (no revision).
 *
 * Everything here is PURE: no I/O, no clock, no config reads except `defaultDerivationOptions()`.
 * Derived values are returned alongside the list of fields that were derived; callers decide
 * whether to persist them (the service never does: they are recomputable, so storing them would
 * only duplicate data and risk drifting from the rules).
 */

import { config } from "./config.js";

export type ImageKind = "front" | "ingredients" | "nutrition" | "packaging";
export const IMAGE_KINDS: readonly ImageKind[] = ["front", "ingredients", "nutrition", "packaging"];

export type ImageSizeName = "thumb" | "small" | "display" | "full";

export interface DerivationOptions {
  /** e.g. https://images.openfoodfacts.org/images/products */
  readonly imagesBaseUrl: string;
  /** Language priority, primary subtags, most preferred first (e.g. ["it", "en"]). */
  readonly languages: readonly string[];
  /**
   * "fill":   derived URLs only fill fields that are missing (stored values win).
   * "prefer": derived URLs replace stored ones (use if stored URLs turn out to be stale/broken).
   */
  readonly imagePolicy: "fill" | "prefer";
  /**
   * When a product has uploads but no *selected* front image: "none" shows nothing (what OFF
   * itself shows), "newest" falls back to the most recent upload (may be the wrong picture).
   */
  readonly uploadFallback: "none" | "newest";
}

export function defaultDerivationOptions(): DerivationOptions {
  return {
    imagesBaseUrl: config.derived.imagesBaseUrl,
    languages: config.derived.languages,
    imagePolicy: config.derived.imagePolicy,
    uploadFallback: config.derived.uploadFallback,
  };
}

/** Image METADATA, deliberately separate from any URL (URLs are generated from this). */
export interface ResolvedImage {
  readonly kind: ImageKind;
  readonly origin: "selected" | "uploaded";
  /** File prefix: "front_it" for selected images, the upload id ("3") for uploaded ones. */
  readonly key: string;
  readonly lang: string | null;
  readonly imageId: string | null;
  readonly revision: string | null;
  /** Numeric renditions that exist (100, 200, 400...). */
  readonly sizes: readonly number[];
  readonly hasFull: boolean;
  readonly width: number | null;
  readonly height: number | null;
}

export interface DerivationResult {
  readonly product: Record<string, unknown>;
  /** Names of the fields that were added/replaced by derivation. Empty when nothing changed. */
  readonly derived: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Image URLs
// ---------------------------------------------------------------------------------------------

/**
 * Folder of a product on the OFF image server (Product Opener `split_code`): barcodes with 9 or
 * more digits are split as 3/3/3/rest, shorter ones (EAN-8) use the code itself.
 * The barcode is handled as a STRING: leading zeros are significant.
 */
export function productImagePath(code: string): string | null {
  const digits = code.trim();
  if (!/^\d{4,24}$/.test(digits)) return null;
  const match = /^(\d{3})(\d{3})(\d{3})(\d*)$/.exec(digits);
  if (!match) return digits;
  return match[4] ? `${match[1]}/${match[2]}/${match[3]}/${match[4]}` : `${match[1]}/${match[2]}/${match[3]}`;
}

const SIZE_PREFERENCE: Record<Exclude<ImageSizeName, "full">, readonly number[]> = {
  thumb: [100, 200],
  small: [200, 400],
  display: [400, 200],
};

function sizeFor(image: ResolvedImage, name: ImageSizeName): number | "full" | null {
  if (name === "full") return image.hasFull ? "full" : null;
  for (const size of SIZE_PREFERENCE[name]) {
    if (image.sizes.includes(size)) return size;
  }
  if (name === "display" && image.hasFull) return "full";
  return null;
}

export function imageUrl(
  options: Pick<DerivationOptions, "imagesBaseUrl">,
  code: string,
  image: ResolvedImage,
  name: ImageSizeName,
): string | null {
  const path = productImagePath(code);
  if (path === null) return null;
  const size = sizeFor(image, name);
  if (size === null) return null;

  let file: string;
  if (image.origin === "selected") {
    if (!image.revision) return null;
    file = `${encodeURIComponent(image.key)}.${image.revision}.${size}.jpg`;
  } else {
    if (!image.imageId) return null;
    file = size === "full" ? `${image.imageId}.jpg` : `${image.imageId}.${size}.jpg`;
  }
  return `${options.imagesBaseUrl.replace(/\/+$/, "")}/${path}/${file}`;
}

/**
 * Resolves, for each image kind, WHICH image OFF would show, from persisted metadata only.
 *
 * Sources, in order of authority:
 *  1. `selected_images.<kind>.<lang>` holding { imgid, rev }  (explicit selection)
 *  2. `images.<kind>_<lang>` / `images.<kind>` holding { rev, sizes }  (the selected image of the
 *     product for that language - this is how the production dump stores the selection)
 *  3. optionally the newest uploaded image (front only), see `uploadFallback`.
 * Language choice: configured priority, then the product's own language, then a language-less
 * key, then any other available language (alphabetical, so it is deterministic).
 */
export function resolveImages(
  product: Record<string, unknown>,
  options: Pick<DerivationOptions, "languages" | "uploadFallback">,
): Partial<Record<ImageKind, ResolvedImage>> {
  const images = record(product.images);
  const selectedImages = record(product.selected_images);
  const productLang = primaryLanguage(firstString(product.lang, product.lc));
  const order = unique([...options.languages.map(primaryLanguage), productLang]
    .filter((value): value is string => value !== null));

  const result: Partial<Record<ImageKind, ResolvedImage>> = {};

  for (const kind of IMAGE_KINDS) {
    const byLanguage = new Map<string, ResolvedImage>();
    const keyPattern = new RegExp(`^${kind}(?:_([a-z]{2,3}(?:[-_][a-z0-9]+)?))?$`, "i");

    if (images) {
      for (const [key, value] of Object.entries(images)) {
        const match = keyPattern.exec(key);
        const meta = record(value);
        if (!match || !meta) continue;
        const revision = scalar(meta.rev);
        if (!revision) continue;
        const lang = match[1] ? match[1].toLowerCase() : null;
        const parsed = parseSizes(record(meta.sizes), [100, 200, 400]);
        byLanguage.set(lang ?? "", {
          kind, origin: "selected", key, lang,
          imageId: scalar(meta.imgid), revision, ...parsed,
        });
      }
    }

    // Explicit selection wins over the implicit one for the same language.
    const selectedForKind = record(selectedImages?.[kind]);
    if (selectedForKind) {
      for (const [lang, value] of Object.entries(selectedForKind)) {
        if (lang === "display" || lang === "small" || lang === "thumb") continue; // API-shaped URL maps
        const meta = record(value);
        const revision = meta ? scalar(meta.rev) : null;
        if (!meta || !revision) continue;
        const imageId = scalar(meta.imgid);
        const sizesSource = record(meta.sizes) ?? (imageId ? record(record(images?.[imageId])?.sizes) : undefined);
        const normalizedLang = lang.toLowerCase();
        byLanguage.set(normalizedLang, {
          kind, origin: "selected", key: `${kind}_${normalizedLang}`, lang: normalizedLang,
          imageId, revision, ...parseSizes(sizesSource, [100, 200, 400]),
        });
      }
    }

    const chosen = chooseByLanguage(byLanguage, order);
    if (chosen) {
      result[kind] = chosen;
    } else if (kind === "front" && options.uploadFallback === "newest") {
      const upload = newestUpload(images);
      if (upload) result[kind] = upload;
    }
  }

  return result;
}

function newestUpload(images: Record<string, unknown> | undefined): ResolvedImage | null {
  if (!images) return null;
  let best: { id: string; time: number; sizes: Record<string, unknown> } | undefined;
  for (const [key, value] of Object.entries(images)) {
    if (!/^\d+$/.test(key)) continue;
    const meta = record(value);
    const sizes = record(meta?.sizes);
    if (!meta || !sizes) continue;
    const time = numberOf(meta.uploaded_t) ?? 0;
    if (!best || time > best.time || (time === best.time && Number(key) > Number(best.id))) {
      best = { id: key, time, sizes };
    }
  }
  if (!best) return null;
  return {
    kind: "front", origin: "uploaded", key: best.id, lang: null,
    imageId: best.id, revision: null, ...parseSizes(best.sizes, [100, 400]),
  };
}

function parseSizes(
  sizes: Record<string, unknown> | undefined,
  fallback: readonly number[],
): { sizes: readonly number[]; hasFull: boolean; width: number | null; height: number | null } {
  if (!sizes || Object.keys(sizes).length === 0) {
    return { sizes: fallback, hasFull: true, width: null, height: null };
  }
  const numeric = Object.keys(sizes)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
  const full = record(sizes.full);
  return {
    sizes: numeric,
    hasFull: "full" in sizes,
    width: numberOf(full?.w),
    height: numberOf(full?.h),
  };
}

function chooseByLanguage<T>(byLanguage: Map<string, T>, order: readonly string[]): T | undefined {
  for (const lang of order) {
    const hit = byLanguage.get(lang);
    if (hit !== undefined) return hit;
  }
  const plain = byLanguage.get("");
  if (plain !== undefined) return plain;
  const others = [...byLanguage.keys()].filter((key) => key !== "").sort();
  const first = others[0];
  return first === undefined ? undefined : byLanguage.get(first);
}

/** API-shaped URL maps that some documents carry: selected_images.<kind>.<display|small|thumb>.<lang> */
function storedSelectedUrl(
  selectedImages: Record<string, unknown> | undefined,
  kind: ImageKind,
  name: Exclude<ImageSizeName, "full">,
  order: readonly string[],
): string | null {
  const byLang = record(record(selectedImages?.[kind])?.[name]);
  if (!byLang) return null;
  const urls = new Map<string, string>();
  for (const [lang, value] of Object.entries(byLang)) {
    if (typeof value === "string" && isHttpUrl(value)) urls.set(lang.toLowerCase(), value.trim());
  }
  return chooseByLanguage(urls, order) ?? null;
}

/** All image fields the API would expose for this product, computed from persisted data. */
export function derivedImageFields(
  code: string,
  product: Record<string, unknown>,
  options: DerivationOptions,
): Record<string, string> {
  const resolved = resolveImages(product, options);
  const selectedImages = record(product.selected_images);
  const productLang = primaryLanguage(firstString(product.lang, product.lc));
  const order = unique([...options.languages.map(primaryLanguage), productLang]
    .filter((value): value is string => value !== null));

  const fields: Record<string, string> = {};
  const put = (field: string, value: string | null): void => {
    if (value !== null) fields[field] = value;
  };

  for (const kind of IMAGE_KINDS) {
    const image = resolved[kind];
    const display = image ? imageUrl(options, code, image, "display") : storedSelectedUrl(selectedImages, kind, "display", order);
    const small = image ? imageUrl(options, code, image, "small") : storedSelectedUrl(selectedImages, kind, "small", order);
    const thumb = image ? imageUrl(options, code, image, "thumb") : storedSelectedUrl(selectedImages, kind, "thumb", order);

    put(`image_${kind}_url`, display);
    put(`image_${kind}_small_url`, small);
    put(`image_${kind}_thumb_url`, thumb);
    if (kind === "front") {
      put("image_url", display);
      put("image_small_url", small);
      put("image_thumb_url", thumb);
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Languages / text / taxonomy
// ---------------------------------------------------------------------------------------------

/**
 * Picks the value of `<base>_<lang>` following the language priority, then any other language
 * (alphabetical). The original per-language fields are never touched.
 */
export function localizedText(
  product: Record<string, unknown>,
  base: string,
  languages: readonly string[],
): string | null {
  const pattern = new RegExp(`^${base}_([a-z]{2,3}(?:[-_][a-z0-9]+)?)$`, "i");
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(product)) {
    const match = pattern.exec(key);
    if (match?.[1] && typeof value === "string" && value.trim().length > 0) {
      values.set(match[1].toLowerCase(), value.trim());
    }
  }
  return chooseByLanguage(values, languages.map(primaryLanguage).filter((v): v is string => v !== null)) ?? null;
}

function derivedTextFields(
  product: Record<string, unknown>,
  languages: readonly string[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  if (!hasText(product.product_name) && !hasText(product.product_name_it)) {
    const name = localizedText(product, "product_name", languages);
    if (name !== null) fields.product_name = name;
  }

  if (!hasText(product.ingredients_text)) {
    const ingredients = localizedText(product, "ingredients_text", languages);
    if (ingredients !== null) fields.ingredients_text = ingredients;
  }

  const tags = product.categories_tags;
  const hierarchy = product.categories_hierarchy;
  if ((!Array.isArray(tags) || tags.length === 0) && Array.isArray(hierarchy) && hierarchy.length > 0) {
    const cleaned = hierarchy.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (cleaned.length > 0) fields.categories_tags = cleaned;
  }

  return fields;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Adds to `product` every field the API would have produced that can be derived locally.
 * Returns the SAME object (identity) when nothing had to be derived.
 */
export function deriveProductFields(
  code: string,
  product: Record<string, unknown>,
  options: DerivationOptions = defaultDerivationOptions(),
): DerivationResult {
  const additions: Record<string, unknown> = {};

  for (const [field, url] of Object.entries(derivedImageFields(code, product, options))) {
    const current = product[field];
    if (current === url) continue;
    if (options.imagePolicy === "fill" && typeof current === "string" && isHttpUrl(current)) continue;
    additions[field] = url;
  }

  Object.assign(additions, derivedTextFields(product, options.languages));

  const names = Object.keys(additions);
  if (names.length === 0) return { product, derived: [] };
  return { product: { ...product, ...additions }, derived: names };
}

// ---------------------------------------------------------------------------------------------
// "Required locally" policy
// ---------------------------------------------------------------------------------------------

/**
 * Whether a field that the caller declared REQUIRED is still missing from a (derived) product.
 * Unknown field names are treated as not missing, so a typo in configuration can never trigger
 * remote calls for every lookup.
 */
export function isRequiredFieldMissing(product: Record<string, unknown>, field: string): boolean {
  switch (field) {
    case "name":
      return !hasText(product.product_name_it) && !hasText(product.product_name);
    case "image":
      return !hasText(product.image_front_url) && !hasText(product.image_front_small_url)
        && !hasText(product.image_front_thumb_url) && !hasText(product.image_url);
    case "quantity":
      return !hasText(product.quantity) && numberOf(product.product_quantity) === null;
    case "nutriments": {
      const nutriments = record(product.nutriments);
      return !nutriments || Object.keys(nutriments).length === 0;
    }
    case "ingredients":
      return !hasText(product.ingredients_text) && !hasText(product.ingredients_text_it);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function primaryLanguage(value: string | null): string | null {
  if (!value) return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
