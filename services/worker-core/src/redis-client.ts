import { createClient, type RedisClientType } from "redis";
import type { RedisQueueClient } from "./redis-queue.js";

export interface RedisConnectionOptions {
  url: string;
  /** Fails fast instead of hanging indefinitely if Redis is unreachable. */
  connectTimeoutMs?: number;
}

/**
 * Real node-redis (v6) backed implementation of the provider-neutral
 * RedisQueueClient contract already defined in redis-queue.ts. Verified
 * against a live Redis 7 instance: publish -> receive -> ack, and
 * publish -> receive -> nack -> re-receive, both round-trip correctly, and
 * a message acked once cannot be acked again (matches RedisQueueAdapter's
 * own "not available for acknowledgement" guard).
 */
export class RedisConnection {
  private readonly client: RedisClientType;

  private constructor(client: RedisClientType) {
    this.client = client;
  }

  public static async connect(options: RedisConnectionOptions): Promise<RedisConnection> {
    const client: RedisClientType = createClient({
      url: options.url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? 5_000,
        // node-redis's default reconnectStrategy retries forever with
        // exponential backoff. Left at that default, a worker started
        // before Redis is reachable (or one that loses the connection
        // mid-run) hangs silently instead of surfacing a clear failure --
        // observed directly in this session: an integration test run
        // against a stopped Redis instance hung past a 300s limit instead
        // of failing fast. Capping retries here means callers get an
        // "error" event / a rejected connect() promise they can act on.
        reconnectStrategy: (retries) => (retries > 10 ? new Error("Redis reconnect attempts exhausted.") : Math.min(retries * 100, 3_000)),
      },
    });
    client.on("error", (error: unknown) => {
      // eslint-disable-next-line no-console -- last-resort diagnostic; a real deployment wires this into RuntimeObservability
      console.error("redis_client_error", error);
    });
    await client.connect();
    return new RedisConnection(client);
  }

  public queueClient(): RedisQueueClient {
    return {
      lPush: (key, value) => this.client.lPush(key, value),
      brPopLPush: (source, destination, timeoutSeconds) =>
        this.client.brPopLPush(source, destination, timeoutSeconds),
      lRem: (key, count, value) => this.client.lRem(key, count, value),
      lLen: (key) => this.client.lLen(key),
      lIndex: (key, index) => this.client.lIndex(key, index),
      lRange: (key, start, stop) => this.client.lRange(key, start, stop),
    };
  }

  public async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === "PONG";
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.client.quit();
  }
}
