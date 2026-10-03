import type { OffSourceProduct, OffSearchDocument, OpenSearchOffIndex } from "./off-search.js";
import { toOffSearchDocument } from "./off-search.js";

export interface SourceSyncOptions {
  readonly sourceUrl: string;
  readonly token: string;
  readonly batchSize: number;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export class OffSourceSync {
  private running = false;

  public get isRunning(): boolean {
    return this.running;
  }

  public constructor(
    private readonly index: OpenSearchOffIndex,
    private readonly options: SourceSyncOptions,
  ) {}

  public async ensureBootstrapped(): Promise<void> {
    if (this.running || !this.options.sourceUrl.trim()) return;
    this.running = true;
    try {
      const count = await this.index.count();
      if (count > 0) return;

      let cursor: string | undefined;
      let total = 0;

      for (;;) {
        const page = await this.fetchPage(cursor);
        if (page.items.length === 0) break;

        const documents: OffSearchDocument[] = [];
        for (const item of page.items) {
          const document = toOffSearchDocument(item);
          if (document) documents.push(document);
        }

        await this.index.bulkUpsert(documents);
        total += documents.length;

        if (!page.nextCursor || page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }

      console.log(JSON.stringify({
        service: "search-indexer",
        event: "off_index_bootstrap_completed",
        indexed: total,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        service: "search-indexer",
        event: "off_index_bootstrap_failed",
        error: error instanceof Error ? error.message : "unknown",
      }));
    } finally {
      this.running = false;
    }
  }

  public async forceRebuild(): Promise<void> {
    if (this.running) throw new Error("off_index_rebuild_already_running");
    this.running = true;
    try {
      await this.index.resetIndex();
      let cursor: string | undefined;
      let total = 0;

      for (;;) {
        const page = await this.fetchPage(cursor);
        if (page.items.length === 0) break;

        const documents: OffSearchDocument[] = [];
        for (const item of page.items) {
          const document = toOffSearchDocument(item);
          if (document) documents.push(document);
        }
        await this.index.bulkUpsert(documents);
        total += documents.length;

        if (!page.nextCursor || page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }

      console.log(JSON.stringify({
        service: "search-indexer",
        event: "off_index_rebuild_completed",
        indexed: total,
      }));
    } finally {
      this.running = false;
    }
  }

  private async fetchPage(cursor: string | undefined): Promise<{ items: OffSourceProduct[]; nextCursor: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const url = new URL(
        "/api/v1/internal/search-source/products",
        this.options.sourceUrl.replace(/\/+$/, ""),
      );
      if (cursor) url.searchParams.set("cursor", cursor);
      url.searchParams.set("limit", String(Math.min(Math.max(this.options.batchSize, 1), 1000)));

      const response = await (this.options.fetchImpl ?? fetch)(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-Internal-Service-Token": this.options.token,
        },
      });
      if (!response.ok) throw new Error(`off_source_http_${response.status}`);

      const body = await response.json() as {
        items?: unknown;
        nextCursor?: unknown;
      };
      const items = Array.isArray(body.items)
        ? body.items.filter(isSourceProduct)
        : [];
      const nextCursor = typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null;
      return { items, nextCursor };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isSourceProduct(value: unknown): value is OffSourceProduct {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.product === "object" && candidate.product !== null && !Array.isArray(candidate.product);
}
