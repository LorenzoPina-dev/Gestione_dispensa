import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const OFF_SEARCH_INDEX = "off-products-v1";
export const OFF_BOOTSTRAP_META_ID = "__off_bootstrap_meta__";
// v9: the index consumes off-lookup's canonical product and stores only the minimal search
// projection. imageUrl is exactly canonical images.front.url (one preview URL, no alternatives).
export const OFF_SEARCH_PROJECTION_VERSION = 9;
export const MIN_OFF_COMPLETENESS = positiveNumberEnv("OFF_SEARCH_MIN_COMPLETENESS", 0.7);

export interface OffSearchDocument {
  code: string;
  name: string;
  nameExact: string;
  brand: string | null;
  brandExact: string | null;
  category: string | null;
  categoriesTags: string[];
  quantityLabel: string | null;
  featureText: string;
  /** Exactly one preview URL: canonical off-lookup images.front.url. */
  imageUrl: string | null;
  popularityKey: number | null;
  completeness: number | null;
}

export interface OffSearchHit {
  readonly code: string;
  readonly product: Record<string, unknown>;
  readonly score: number;
}

export interface OffSearchResult {
  readonly status: "found" | "unavailable";
  readonly hits: readonly OffSearchHit[];
  readonly reason?: string;
}

export interface OffSourceProduct {
  readonly code: string;
  readonly product: Record<string, unknown>;
}

export interface OffBootstrapState {
  readonly status: "in_progress" | "complete";
  readonly cursor: string | null;
  readonly projectionVersion?: number | null;
}

const MAX_LIMIT = 50;

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function toOffSearchDocument(input: OffSourceProduct): OffSearchDocument | undefined {
  const product = input.product;
  const name = firstString(product.name, product.product_name_it, product.product_name);
  if (!name) return undefined;

  const brand = firstString(product.brand, product.brands);
  const categoriesTags = stringArray(
    Array.isArray(product.categories) && product.categories.length > 0
      ? product.categories
      : product.categories_tags,
  );
  const category = firstString(product.category);
  const quantity = record(product.quantity);
  const quantityLabel = firstString(quantity?.label, product.quantity_label, product.quantity);
  const featureText = buildFeatureText(product);
  const images = record(product.images);
  const front = record(images?.front);
  // off-lookup has already resolved the authoritative preview image. Never select a different
  // rendition, packaging image, ingredients image, or arbitrary raw image here.
  const imageUrl = firstHttpUrl(front?.url, product.image_front_url, product.image_url);
  const popularityKey = numberFrom(product.popularity_key);
  const completeness = numberFrom(product.completeness);

  return {
    code: input.code,
    name,
    nameExact: normalizeSearchText(name),
    brand,
    brandExact: brand ? normalizeSearchText(brand) : null,
    category,
    categoriesTags,
    quantityLabel,
    featureText,
    imageUrl,
    popularityKey,
    completeness,
  };
}

export function toProviderProduct(document: OffSearchDocument): Record<string, unknown> {
  return {
    product_name: document.name,
    ...(document.brand ? { brands: document.brand } : {}),
    ...(document.category ? { category: document.category } : {}),
    categories_tags: document.categoriesTags,
    ...(document.quantityLabel ? { quantity: document.quantityLabel } : {}),
    ...(document.imageUrl ? { image_front_url: document.imageUrl } : {}),
    ...(document.popularityKey === null ? {} : { popularity_key: document.popularityKey }),
    ...(document.completeness === null ? {} : { completeness: document.completeness }),
  };
}

export function rankOffSearchHits(
  query: string,
  hits: readonly OffSearchHit[],
  limit: number,
): readonly OffSearchHit[] {
  const normalized = normalizeSearchText(query);
  const queryTokens = new Set(normalized.split(" ").filter(Boolean));

  const ranked = hits.map((hit) => {
    const document = hit.product;
    const name = normalizeSearchText(String(document.product_name ?? ""));
    const brand = normalizeSearchText(String(document.brands ?? ""));
    const category = normalizeSearchText(String(document.category ?? ""));
    const featureText = normalizeSearchText(String(document.featureText ?? ""));
    const tokens = new Set([
      ...name.split(" ").filter(Boolean),
      ...brand.split(" ").filter(Boolean),
      ...category.split(" ").filter(Boolean),
      ...featureText.split(" ").filter(Boolean),
    ]);

    const exact = name === normalized ? 1000 : 0;
    const prefix = name.startsWith(normalized) ? 300 : 0;
    const phrase = name.includes(normalized) ? 150 : 0;
    const exactBrand = brand === normalized ? 850 : 0;
    const brandPrefix = brand.startsWith(normalized) ? 280 : 0;
    const tokenMatch = [...queryTokens].filter((token) => tokens.has(token)).length * 45;
    const brandMatch = normalized && brand.includes(normalized) ? 100 : 0;
    const categoryMatch = normalized && category.includes(normalized) ? 45 : 0;
    const featureMatch = normalized && featureText.includes(normalized) ? 80 : 0;
    const lexical = Math.min(100, Math.max(0, hit.score)) * 2;
    const completeness = numberFrom(document.completeness) ?? 0;
    const popularity = Math.log10(1 + Math.max(0, numberFrom(document.popularity_key) ?? 0));
    const finalScore = exact + prefix + phrase + exactBrand + brandPrefix + tokenMatch
      + brandMatch + categoryMatch + featureMatch + lexical + completeness * 30 + popularity * 8;

    return { hit, finalScore };
  });

  return ranked
    .sort((a, b) => b.finalScore - a.finalScore || a.hit.code.localeCompare(b.hit.code))
    .slice(0, Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT))
    .map(({ hit }) => hit);
}

export class OpenSearchOffIndex {
  private ensured = false;

  public constructor(
    private readonly baseUrl: string,
    private readonly indexName = OFF_SEARCH_INDEX,
    private readonly timeoutMs = 1500,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async ensureIndex(): Promise<void> {
    if (this.ensured) return;

    const exists = await this.rawFetch(`/${encodeURIComponent(this.indexName)}`, { method: "HEAD" });
    if (exists.status === 404) {
      const created = await this.rawFetch(`/${encodeURIComponent(this.indexName)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: {
            index: { number_of_shards: 1, number_of_replicas: 0 },
            analysis: {
              analyzer: {
                off_text: {
                  type: "custom",
                  tokenizer: "standard",
                  filter: ["lowercase", "asciifolding"],
                },
              },
            },
          },
          mappings: {
            dynamic: false,
            properties: {
              code: { type: "keyword" },
              name: { type: "text", analyzer: "off_text" },
              nameExact: { type: "keyword" },
              brand: { type: "text", analyzer: "off_text" },
              brandExact: { type: "keyword" },
              category: { type: "text", analyzer: "off_text" },
              categoriesTags: { type: "keyword" },
              quantityLabel: { type: "text", analyzer: "off_text" },
              // One canonical preview URL; not searched.
              imageUrl: { type: "keyword", index: false },
              popularityKey: { type: "double" },
              completeness: { type: "double" },
            },
          },
        }),
      });
      if (!created.ok && created.status !== 400) {
        throw new Error(`opensearch_index_create_failed_${created.status}`);
      }
    } else if (!exists.ok) {
      throw new Error(`opensearch_index_check_failed_${exists.status}`);
    }

    // Keep the mapping compatible with existing indexes. Projection versioning below forces
    // a full rebuild when the indexed shape changes.
    const mapping = await this.rawFetch(
      `/${encodeURIComponent(this.indexName)}/_mapping`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          properties: {
            featureText: { type: "text", analyzer: "off_text" },
          },
        }),
      },
    );
    if (!mapping.ok && mapping.status !== 400) {
      throw new Error(`opensearch_mapping_update_failed_${mapping.status}`);
    }

    this.ensured = true;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      await this.ensureIndex();
      const response = await this.rawFetch("/_cluster/health", { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  public async count(): Promise<number> {
    await this.ensureIndex();
    const response = await this.rawFetch(`/${encodeURIComponent(this.indexName)}/_count`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: {
          bool: {
            filter: [{ range: { completeness: { gte: MIN_OFF_COMPLETENESS } } }],
            must: [{ exists: { field: "code" } }],
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`opensearch_count_failed_${response.status}`);
    const body = await response.json() as { count?: unknown };
    return typeof body.count === "number" && Number.isFinite(body.count) ? body.count : 0;
  }

  public async getBootstrapState(): Promise<OffBootstrapState | undefined> {
    await this.ensureIndex();
    const response = await this.rawFetch(
      `/${encodeURIComponent(this.indexName)}/_doc/${encodeURIComponent(OFF_BOOTSTRAP_META_ID)}`,
      { method: "GET" },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`opensearch_bootstrap_state_get_failed_${response.status}`);
    const body = await response.json() as { _source?: unknown };
    if (!body._source || typeof body._source !== "object") return undefined;
    const source = body._source as Record<string, unknown>;
    const status = source.status;
    const cursor = source.cursor;
    if (status !== "in_progress" && status !== "complete") return undefined;
    return {
      status,
      cursor: typeof cursor === "string" && cursor.length > 0 ? cursor : null,
      projectionVersion:
        typeof source.projectionVersion === "number" && Number.isInteger(source.projectionVersion)
          ? source.projectionVersion
          : null,
    };
  }

  public async putBootstrapState(state: OffBootstrapState): Promise<void> {
    await this.ensureIndex();
    const response = await this.rawFetch(
      `/${encodeURIComponent(this.indexName)}/_doc/${encodeURIComponent(OFF_BOOTSTRAP_META_ID)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...state,
          projectionVersion: OFF_SEARCH_PROJECTION_VERSION,
          updatedAt: new Date().toISOString(),
        }),
      },
    );
    if (!response.ok) throw new Error(`opensearch_bootstrap_state_put_failed_${response.status}`);
  }

  public async resetIndex(): Promise<void> {
    const response = await this.rawFetch(`/${encodeURIComponent(this.indexName)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`opensearch_index_delete_failed_${response.status}`);
    }
    this.ensured = false;
    await this.ensureIndex();
  }

  public async upsert(document: OffSearchDocument): Promise<void> {
    if (!isEligibleSearchDocument(document)) return;
    await this.ensureIndex();
    const response = await this.rawFetch(
      `/${encodeURIComponent(this.indexName)}/_doc/${encodeURIComponent(document.code)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(document),
      },
    );
    if (!response.ok) throw new Error(`opensearch_upsert_failed_${response.status}`);
  }

  public async bulkUpsert(documents: readonly OffSearchDocument[]): Promise<void> {
    const eligibleDocuments = documents.filter(isEligibleSearchDocument);
    if (eligibleDocuments.length === 0) return;
    await this.ensureIndex();

    const body = eligibleDocuments.map((document) =>
      JSON.stringify({ index: { _index: this.indexName, _id: document.code } }) + "\n" +
      JSON.stringify(document) + "\n"
    ).join("");

    const response = await this.rawFetch("/_bulk", {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body,
    });
    if (!response.ok) throw new Error(`opensearch_bulk_failed_${response.status}`);

    const result = await response.json() as { errors?: unknown };
    if (result.errors === true) throw new Error("opensearch_bulk_contains_errors");
  }

  public async purgeIneligibleDocuments(): Promise<number> {
    await this.ensureIndex();
    const response = await this.rawFetch(
      `/${encodeURIComponent(this.indexName)}/_delete_by_query?conflicts=proceed&refresh=false`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: {
            bool: {
              must_not: [{ ids: { values: [OFF_BOOTSTRAP_META_ID] } }],
              should: [
                { range: { completeness: { lt: MIN_OFF_COMPLETENESS } } },
                { bool: { must_not: [{ exists: { field: "completeness" } }] } },
              ],
              minimum_should_match: 1,
            },
          },
        }),
      },
    );
    if (!response.ok) throw new Error("opensearch_quality_cleanup_failed_" + response.status);
    const body = await response.json() as { deleted?: unknown };
    return typeof body.deleted === "number" && Number.isFinite(body.deleted) ? body.deleted : 0;
  }

  public async search(query: string, limit: number): Promise<OffSearchResult> {
    const normalized = normalizeSearchText(query);
    if (!normalized) return { status: "found", hits: [] };

    try {
      await this.ensureIndex();
      const size = Math.min(Math.max(Math.floor(limit) * 5, 10), 50);
      const body = {
        size,
        track_total_hits: false,
        _source: [
          "code", "name", "brand", "category", "categoriesTags", "quantityLabel", "featureText",
          "imageUrl", "popularityKey", "completeness",
        ],
        query: {
          bool: {
            filter: [{ range: { completeness: { gte: MIN_OFF_COMPLETENESS } } }],
            should: [
              { term: { nameExact: { value: normalized, boost: 14 } } },
              { prefix: { nameExact: { value: normalized, boost: 8 } } },
              { term: { brandExact: { value: normalized, boost: 12 } } },
              { prefix: { brandExact: { value: normalized, boost: 7 } } },
              { match_phrase: { name: { query: normalized, boost: 10 } } },
              { match_phrase: { brand: { query: normalized, boost: 9 } } },
              { match_phrase: { category: { query: normalized, boost: 6 } } },
              {
                multi_match: {
                  query: normalized,
                  fields: [
                    "name^8",
                    "brand^8",
                    "category^5",
                    "featureText^6",
                    "quantityLabel^3",
                  ],
                  operator: "and",
                  fuzziness: "AUTO",
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
      };

      const response = await this.rawFetch(`/${encodeURIComponent(this.indexName)}/_search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return { status: "unavailable", hits: [], reason: `http_${response.status}` };
      }

      const json = await response.json() as {
        hits?: { hits?: Array<{ _score?: unknown; _source?: unknown }> };
      };
      const rawHits = json.hits?.hits ?? [];
      const hits: OffSearchHit[] = [];

      for (const raw of rawHits) {
        if (!raw._source || typeof raw._source !== "object") continue;
        const source = raw._source as Record<string, unknown>;
        const code = typeof source.code === "string" ? source.code : "";
        if (!/^\d{8,14}$/.test(code)) continue;
        const score = typeof raw._score === "number" && Number.isFinite(raw._score) ? raw._score : 0;
        hits.push({ code, product: toProviderProductFromSource(source), score });
      }

      return { status: "found", hits: rankOffSearchHits(normalized, hits, limit) };
    } catch (error) {
      return {
        status: "unavailable",
        hits: [],
        reason: error instanceof Error ? error.message : "opensearch_error",
      };
    }
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`;
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toProviderProductFromSource(source: Record<string, unknown>): Record<string, unknown> {
  const categories = Array.isArray(source.categoriesTags)
    ? source.categoriesTags.filter((value): value is string => typeof value === "string")
    : [];

  // Rehydrate only the minimal provider-shaped fields expected by off-lookup normalization.
  // The preview is deliberately a single URL, sourced from the canonical front image.
  const product: Record<string, unknown> = {
    product_name: typeof source.name === "string" ? source.name : "",
    brands: typeof source.brand === "string" ? source.brand : "",
    categories_tags: categories,
  };

  for (const [sourceKey, targetKey] of [
    ["category", "category"],
    ["quantityLabel", "quantity"],
    ["imageUrl", "image_front_url"],
    ["popularityKey", "popularity_key"],
    ["completeness", "completeness"],
  ] as const) {
    const value = source[sourceKey];
    if (sourceKey === "imageUrl") {
      if (typeof value === "string" && isHttpUrl(value)) product[targetKey] = value;
      continue;
    }
    if (value !== null && value !== undefined && value !== "") product[targetKey] = value;
  }

  return product;
}

function positiveNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isEligibleSearchDocument(document: OffSearchDocument): boolean {
  return typeof document.completeness === "number"
    && Number.isFinite(document.completeness)
    && document.completeness >= MIN_OFF_COMPLETENESS;
}

function buildFeatureText(product: Record<string, unknown>): string {
  const values = [
    product.generic_name_it,
    product.generic_name_en,
    product.generic_name,
    product.abbreviated_product_name_it,
    product.abbreviated_product_name_en,
    product.abbreviated_product_name,
    product.labels,
    ...stringArray(product.labels_tags),
    ...stringArray(product.brands_tags),
    product.packaging,
    ...stringArray(product.packaging_tags),
    product.packaging_text,
    product.ingredients_text_it,
    product.ingredients_text_en,
    product.ingredients_text,
    ...stringArray(product.ingredients_tags),
    product.allergens,
    ...stringArray(product.allergens_tags),
    product.traces,
    ...stringArray(product.traces_tags),
    product.origins,
    ...stringArray(product.origins_tags),
    product.stores,
    ...stringArray(product.stores_tags),
    product.countries,
    ...stringArray(product.countries_tags),
    product.manufacturing_places,
    ...stringArray(product.manufacturing_places_tags),
    ...stringArray(product.food_groups_tags),
    ...stringArray(product.additives_tags),
    product.nutriScore && record(product.nutriScore)?.grade,
    product.nova?.group,
    record(product.ingredients)?.text,
    record(product.packaging)?.text,
    ...stringArray(product.labels),
    ...stringArray(product.categories),
    ...stringArray(product.countries),
    ...stringArray(product.traces),
  ].flatMap((value) => {
    if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
    if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
    return [];
  });

  return values.join(" ").slice(0, 6000);
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function firstHttpUrl(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && isHttpUrl(value)) return value.trim();
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

