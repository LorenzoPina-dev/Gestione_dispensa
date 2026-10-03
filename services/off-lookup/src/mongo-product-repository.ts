import { MongoClient, type Collection, type Db } from "mongodb";
import {
  CURRENT_CACHE_ENRICHMENT_VERSION,
  CURRENT_CACHE_SCHEMA_VERSION,
  mergeMissingFields,
  isRecord,
} from "./cache-policy.js";
import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Local MongoDB store for Open Food Facts products.
 *
 * Two kinds of documents can live in "off.products":
 *  - "bulk-import": rows restored from the official Open Food Facts mongodump;
 *  - "live-api": documents learned from the public OFF API.
 *
 * A live API refresh is conservative: existing product values are preserved and only missing
 * fields are filled. Cache metadata records the enrichment contract and the last refresh attempt.
 *
 * This repository is an OPTIONAL accelerator, never a hard dependency. Every Mongo operation
 * swallows its own failures and is bounded by a timeout, so the lookup service can fall through
 * to the live API or return an existing cached product without crashing.
 */

export interface ProductDocument {
  readonly code: string;
  readonly [field: string]: unknown;
}

export type RefreshOutcome = "success" | "not_found" | "error";

export interface SearchSourcePage {
  readonly items: readonly { code: string; product: Record<string, unknown> }[];
  readonly nextCursor: string | null;
}

export interface ProductRepository {
  findByCode(code: string): Promise<ProductDocument | undefined>;
  upsertFromLiveApi(code: string, product: Record<string, unknown>): Promise<void>;
  listSearchSourcePage?(cursor: string | undefined, limit: number): Promise<SearchSourcePage>;
  recordRefreshAttempt(code: string, outcome: RefreshOutcome): Promise<void>;
  /** Best-effort liveness check for the readiness endpoint. Never throws. */
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
}

/** Used when OFF_LOOKUP_MONGO_URL is not configured: every lookup is a miss. */
export class NullProductRepository implements ProductRepository {
  public async findByCode(): Promise<ProductDocument | undefined> {
    return undefined;
  }
  public async upsertFromLiveApi(): Promise<void> {
    // no-op
  }
  public async recordRefreshAttempt(): Promise<void> {
    // no-op
  }
  public async isAvailable(): Promise<boolean> {
    return false;
  }
  public async close(): Promise<void> {
    // no-op
  }
}

interface RawDocument {
  readonly _id: unknown;
  readonly code: string;
  readonly [field: string]: unknown;
}

const SEARCH_PROJECTION = {
  _id: 0,
  code: 1,
  product_name: 1,
  product_name_it: 1,
  product_name_en: 1,
  brands: 1,
  categories_tags: 1,
  quantity: 1,
  product_quantity: 1,
  product_quantity_unit: 1,
  category: 1,
  image_front_url: 1,
  image_front_small_url: 1,
  image_front_thumb_url: 1,
  "nutriments.energy-kcal_100g": 1,
  "nutriments.proteins_100g": 1,
  "nutriments.carbohydrates_100g": 1,
  "nutriments.fat_100g": 1,
  "nutriments.fiber_100g": 1,
  popularity_key: 1,
  completeness: 1,
} as const;

export class MongoProductRepository implements ProductRepository {
  private client: MongoClient | undefined;
  private connecting: Promise<Collection<RawDocument>> | undefined;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public async findByCode(code: string): Promise<ProductDocument | undefined> {
    return this.withCollection(async (collection) => {
      const doc = await collection.findOne({ code }, { maxTimeMS: config.mongo.operationTimeoutMs });
      if (doc === null) return undefined;
      const { _id, ...rest } = doc;
      void _id;
      return rest as ProductDocument;
    });
  }

  public async upsertFromLiveApi(code: string, product: Record<string, unknown>): Promise<void> {
    await this.withCollection(async (collection) => {
      const existingDoc = await collection.findOne(
        { code },
        { maxTimeMS: config.mongo.operationTimeoutMs },
      );

      const existing = existingDoc === null
        ? undefined
        : (() => {
            const { _id, _cache_meta, ...rest } = existingDoc;
            void _id;
            return {
              product: rest as Record<string, unknown>,
              metadata: isRecord(_cache_meta) ? _cache_meta : undefined,
            };
          })();

      const merged = existing === undefined
        ? { ...product }
        : mergeMissingFields(existing.product, product);

      const now = new Date().toISOString();
      const existingMetadata = existing?.metadata ?? {};
      const origin =
        typeof existingMetadata.origin === "string"
          ? existingMetadata.origin
          : existing === undefined
            ? "live-api"
            : "bulk-import";

      await collection.updateOne(
        { code },
        {
          $set: {
            ...merged,
            code,
            _cache_meta: {
              ...existingMetadata,
              origin,
              cachedAt:
                typeof existingMetadata.cachedAt === "string"
                  ? existingMetadata.cachedAt
                  : now,
              schemaVersion: CURRENT_CACHE_SCHEMA_VERSION,
              enrichmentVersion: CURRENT_CACHE_ENRICHMENT_VERSION,
              lastRefreshAttemptAt: now,
              lastRefreshAt: now,
              lastRefreshOutcome: "success",
            },
          },
        },
        { upsert: true, maxTimeMS: config.mongo.operationTimeoutMs },
      );
      return undefined;
    });
  }

  public async listSearchSourcePage(
    cursor: string | undefined,
    limit: number,
  ): Promise<SearchSourcePage> {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
    const projection = SEARCH_PROJECTION;

    return (await this.withCollection(async (collection) => {
      const filter = cursor ? { code: { $gt: cursor } } : {};
      const docs = await collection
        .find(filter, { projection, maxTimeMS: config.mongo.operationTimeoutMs })
        .sort({ code: 1 })
        .limit(safeLimit)
        .toArray();

      const items = docs.map((doc) => ({
        code: doc.code,
        product: Object.fromEntries(
          Object.entries(doc).filter(([key]) => key !== "_id"),
        ),
      }));
      return {
        items,
        nextCursor: items.length === safeLimit ? items.at(-1)?.code ?? null : null,
      };
    }, config.mongo.sourceOperationTimeoutMs)) ?? { items: [], nextCursor: null };
  }

  public async recordRefreshAttempt(
    code: string,
    outcome: RefreshOutcome,
  ): Promise<void> {
    await this.withCollection(async (collection) => {
      await collection.updateOne(
        { code },
        {
          $set: {
            "_cache_meta.lastRefreshAttemptAt": new Date().toISOString(),
            "_cache_meta.lastRefreshOutcome": outcome,
          },
        },
        { upsert: false, maxTimeMS: config.mongo.operationTimeoutMs },
      );
      return undefined;
    });
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const collection = await this.connect();
      await collection.findOne({}, { maxTimeMS: config.mongo.operationTimeoutMs, projection: { _id: 1 } });
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // shutting down anyway
    }
  }

  private async withCollection<T>(
    operation: (collection: Collection<RawDocument>) => Promise<T>,
    timeoutMs = config.mongo.operationTimeoutMs,
  ): Promise<T | undefined> {
    if (Date.now() < this.circuitOpenUntil) return undefined;

    try {
      const collection = await this.connect();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          operation(collection),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("mongo_operation_timeout")), timeoutMs);
          }),
        ]);
        this.consecutiveFailures = 0;
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    } catch (error) {
      this.recordFailure(error);
      return undefined;
    }
  }

  private recordFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    log("error", "mongo_operation_failed", {
      error: error instanceof Error ? error.message : "unknown",
      consecutiveFailures: this.consecutiveFailures,
    });
    if (this.consecutiveFailures >= config.mongo.maxConsecutiveFailures) {
      this.circuitOpenUntil = Date.now() + config.mongo.cooldownMs;
      log("error", "mongo_circuit_open", {
        cooldownMs: config.mongo.cooldownMs,
        resumesAt: new Date(this.circuitOpenUntil).toISOString(),
      });
      this.client = undefined;
      this.connecting = undefined;
    }
  }

  private async connect(): Promise<Collection<RawDocument>> {
    if (this.connecting === undefined) {
      this.connecting = this.doConnect();
    }
    return this.connecting;
  }

  private async doConnect(): Promise<Collection<RawDocument>> {
    const client = new MongoClient(config.mongo.url, {
      connectTimeoutMS: config.mongo.connectTimeoutMs,
      serverSelectionTimeoutMS: config.mongo.connectTimeoutMs,
    });
    await client.connect();
    this.client = client;
    const db: Db = client.db(config.mongo.dbName);
    const collection = db.collection<RawDocument>(config.mongo.collectionName);
    void collection.createIndex({ code: 1 }).catch((error: unknown) => {
      log("error", "mongo_index_creation_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    });
    return collection;
  }
}
