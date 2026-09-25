import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Local MongoDB store for Open Food Facts products.
 *
 * Two kinds of documents can live in `off.products`:
 *  - "bulk-import": rows restored verbatim from the official Open Food Facts mongodump
 *    (`openfoodfacts-mongodbdump` at the repo root, restored with `mongorestore`). These are the
 *    raw OFF product documents, keyed by their own `code` field, with no `_cache_meta`.
 *  - "live-api": documents this service writes itself after a successful fallback call to the
 *    live OFF API for a barcode that was not (yet) present locally. Written in the SAME flat
 *    shape as a bulk-import document (so both are indistinguishable to a reader), plus a
 *    `_cache_meta` field (namespaced with a leading underscore, which no real OFF field uses) to
 *    record provenance/freshness.
 *
 * This repository is an OPTIONAL accelerator, never a hard dependency: the whole point of the
 * read-through design (see product-lookup-service.ts) is that the service keeps answering
 * barcode lookups even if this database is absent, unreachable, still restoring the dump, or
 * simply too large for the current host. Every method therefore swallows its own failures
 * instead of throwing:
 *  - the MongoClient connection is established lazily on first use, never at startup;
 *  - every operation races against `operationTimeoutMs`, so a slow/overloaded Mongo can never
 *    slow down a lookup beyond that ceiling;
 *  - after `maxConsecutiveFailures` in a row, a circuit breaker opens for `cooldownMs`: further
 *    calls short-circuit to "unavailable" without touching the network at all, so a genuinely
 *    down database degrades to instant misses instead of adding latency to every request.
 */

export interface ProductDocument {
  readonly code: string;
  readonly [field: string]: unknown;
}

export interface ProductRepository {
  findByCode(code: string): Promise<ProductDocument | undefined>;
  upsertFromLiveApi(code: string, product: Record<string, unknown>): Promise<void>;
  /** Best-effort liveness check for the readiness endpoint. Never throws. */
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
}

/** Used when OFF_LOOKUP_MONGO_URL is not configured: every lookup is a miss, every write is a no-op. */
export class NullProductRepository implements ProductRepository {
  public async findByCode(): Promise<ProductDocument | undefined> {
    return undefined;
  }
  public async upsertFromLiveApi(): Promise<void> {
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
      await collection.updateOne(
        { code },
        {
          $set: {
            ...product,
            code,
            _cache_meta: { origin: "live-api", cachedAt: new Date().toISOString() },
          },
        },
        { upsert: true, maxTimeMS: config.mongo.operationTimeoutMs },
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

  /**
   * Runs `operation` against the collection, timing it out at operationTimeoutMs and folding any
   * failure (connect error, timeout, driver error) into "not available right now" instead of
   * propagating. This is the single invariant this class must uphold.
   */
  private async withCollection<T>(
    operation: (collection: Collection<RawDocument>) => Promise<T>,
  ): Promise<T | undefined> {
    if (Date.now() < this.circuitOpenUntil) return undefined;

    try {
      const collection = await this.connect();
      const result = await Promise.race([
        operation(collection),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("mongo_operation_timeout")), config.mongo.operationTimeoutMs);
        }),
      ]);
      this.consecutiveFailures = 0;
      return result;
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
      // Drop the connection so the next attempt after cooldown starts clean.
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
    // Fire-and-forget: the required `{ code: 1 }` index (see README) should already exist from
    // the mongorestore of the official dump, but a fresh/empty database still needs it. Index
    // creation never blocks a lookup and its failure is logged, not thrown.
    void collection.createIndex({ code: 1 }).catch((error: unknown) => {
      log("error", "mongo_index_creation_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    });
    return collection;
  }
}

export function createProductRepository(): ProductRepository {
  const enabled = config.mongo.url.trim().length > 0;
  log("info", "mongo_repository_configured", {
    enabled,
    db: config.mongo.dbName,
    collection: config.mongo.collectionName,
  });
  return enabled ? new MongoProductRepository() : new NullProductRepository();
}
