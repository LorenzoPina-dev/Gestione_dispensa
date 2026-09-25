import { MongoClient, type Collection, type Db } from "mongodb";
import type { BarcodeProviderResponse } from "./barcode.js";

/**
 * Read-through cache for Open Food Facts lookups, backed by a MongoDB instance that is
 * DELIBERATELY separate from the main worker-integrations dependency graph. See
 * docs/ADR-0005-off-cache-datastore.md for the rationale.
 *
 * This is an optional dependency by design: the pantry app must keep working (falling straight
 * through to the live Open Food Facts API, exactly like before this cache existed) whether the
 * cache database is absent, unreachable, slow, or the hardware it runs on cannot hold the full
 * Open Food Facts dump. Every method on MongoOffCacheRepository therefore swallows its own
 * failures instead of throwing, and CachingBarcodeProvider never lets a cache problem affect the
 * barcode lookup outcome.
 */

export interface OffCacheEntry {
  /** Normalized barcode, matches BarcodeCatalogAdapter's normalizeBarcode() output. */
  readonly identifier: string;
  readonly response: BarcodeProviderResponse;
  /** ISO timestamp of when this entry was written to the cache (bulk import or live fallback). */
  readonly cachedAt: string;
  /** "bulk-import" for rows seeded from the Open Food Facts dump, "live" for API fallbacks. */
  readonly origin: "bulk-import" | "live";
}

export interface OffCacheRepository {
  get(identifier: string): Promise<OffCacheEntry | undefined>;
  set(entry: OffCacheEntry): Promise<void>;
  /** Best-effort liveness check for telemetry/health endpoints. Never throws. */
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * No-op repository used whenever OFF_CACHE_MONGO_URL is not configured. Keeps the cache
 * genuinely optional: server.ts wires this in with zero behavioural difference from the
 * pre-cache pipeline.
 */
export class NullOffCacheRepository implements OffCacheRepository {
  public async get(): Promise<OffCacheEntry | undefined> {
    return undefined;
  }
  public async set(): Promise<void> {
    // no-op
  }
  public async isAvailable(): Promise<boolean> {
    return false;
  }
  public async close(): Promise<void> {
    // no-op
  }
}

export interface MongoOffCacheRepositoryOptions {
  readonly mongoUrl: string;
  readonly dbName: string;
  readonly collectionName: string;
  /** Hard ceiling for every single cache operation; a slow cache must never slow down a lookup. */
  readonly operationTimeoutMs: number;
  /**
   * After this many consecutive failures (connect or operation), stop attempting the cache for
   * `cooldownMs` and treat every call as a miss. Prevents a dead/absent Mongo from adding
   * latency to every single barcode scan.
   */
  readonly maxConsecutiveFailures: number;
  readonly cooldownMs: number;
  readonly log: (level: "info" | "error", event: string, fields?: Record<string, unknown>) => void;
  readonly now?: () => number;
}

/**
 * MongoDB-backed implementation. Connection is established lazily on first use (never blocks
 * server startup) and is circuit-broken: repeated failures trip a cooldown window during which
 * the repository short-circuits to "unavailable" without touching the network at all.
 */
export class MongoOffCacheRepository implements OffCacheRepository {
  private readonly options: MongoOffCacheRepositoryOptions;
  private readonly now: () => number;
  private client: MongoClient | undefined;
  private connecting: Promise<Collection<OffCacheDocument>> | undefined;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(options: MongoOffCacheRepositoryOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  public async get(identifier: string): Promise<OffCacheEntry | undefined> {
    return this.withCollection(async (collection) => {
      const doc = await collection.findOne(
        { _id: identifier },
        { maxTimeMS: this.options.operationTimeoutMs },
      );
      if (doc === null) return undefined;
      return {
        identifier: doc._id,
        response: doc.response,
        cachedAt: doc.cachedAt,
        origin: doc.origin,
      };
    });
  }

  public async set(entry: OffCacheEntry): Promise<void> {
    await this.withCollection(async (collection) => {
      await collection.updateOne(
        { _id: entry.identifier },
        {
          $set: {
            _id: entry.identifier,
            response: entry.response,
            cachedAt: entry.cachedAt,
            origin: entry.origin,
          },
        },
        { upsert: true, maxTimeMS: this.options.operationTimeoutMs },
      );
      return undefined;
    });
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const collection = await this.connect();
      await collection.findOne({}, { maxTimeMS: this.options.operationTimeoutMs });
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
   * failure (connect error, timeout, driver error) into a plain "not available right now" outcome
   * instead of propagating -- the one invariant this class must uphold is that it never makes a
   * barcode lookup fail or hang because of the cache.
   */
  private async withCollection<T>(
    operation: (collection: Collection<OffCacheDocument>) => Promise<T>,
  ): Promise<T | undefined> {
    if (this.now() < this.circuitOpenUntil) return undefined;

    try {
      const collection = await this.connect();
      const result = await Promise.race([
        operation(collection),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("off_cache_operation_timeout")), this.options.operationTimeoutMs);
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
    this.options.log("error", "off_cache_operation_failed", {
      error: error instanceof Error ? error.message : "unknown",
      consecutiveFailures: this.consecutiveFailures,
    });
    if (this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
      this.circuitOpenUntil = this.now() + this.options.cooldownMs;
      this.options.log("error", "off_cache_circuit_open", {
        cooldownMs: this.options.cooldownMs,
        resumesAt: new Date(this.circuitOpenUntil).toISOString(),
      });
      // Drop the connection so the next attempt after cooldown starts clean.
      this.client = undefined;
      this.connecting = undefined;
    }
  }

  private async connect(): Promise<Collection<OffCacheDocument>> {
    if (this.connecting === undefined) {
      this.connecting = this.doConnect();
    }
    return this.connecting;
  }

  private async doConnect(): Promise<Collection<OffCacheDocument>> {
    const client = new MongoClient(this.options.mongoUrl, {
      connectTimeoutMS: this.options.operationTimeoutMs,
      serverSelectionTimeoutMS: this.options.operationTimeoutMs,
    });
    await client.connect();
    this.client = client;
    const db: Db = client.db(this.options.dbName);
    return db.collection<OffCacheDocument>(this.options.collectionName);
  }
}

interface OffCacheDocument {
  readonly _id: string;
  readonly response: BarcodeProviderResponse;
  readonly cachedAt: string;
  readonly origin: "bulk-import" | "live";
}
