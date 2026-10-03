import type { OffSourceProduct, OffSearchDocument, OpenSearchOffIndex } from "./off-search.js";
import {
  MIN_OFF_COMPLETENESS,
  OFF_SEARCH_PROJECTION_VERSION,
  toOffSearchDocument,
} from "./off-search.js";

export interface SourceSyncOptions {
  readonly sourceUrl: string;
  readonly token: string;
  readonly batchSize: number;
  readonly timeoutMs: number;
  readonly batchDelayMs: number;
  readonly maxBatchesPerRun: number;
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
      const purged = await this.index.purgeIneligibleDocuments();
      if (purged > 0) {
        console.log(JSON.stringify({
          service: "search-indexer",
          event: "off_index_quality_cleanup",
          deleted: purged,
          minimumCompleteness: MIN_OFF_COMPLETENESS,
        }));
      }

      const state = await this.index.getBootstrapState();

      // A completed checkpoint is terminal for this source snapshot. Without this guard the
      // retry timer would restart the 4.8M-document import from the beginning forever.
      if (
        state?.status === "complete"
        && state.projectionVersion === OFF_SEARCH_PROJECTION_VERSION
      ) {
        return;
      }

      if (state?.status === "complete") {
        // Projection policy changed (quality gate/features). Rebuild the searchable projection.
        await this.index.resetIndex();
      }

      // Existing documents without a checkpoint
      // (for example a barcode lookup) or from an interrupted legacy bootstrap. They cannot
      // prove that the full Mongo dump was indexed, so rebuild once and start with a checkpoint.
      if (state === undefined && (await this.index.count()) > 0) {
        await this.index.resetIndex();
      }

      await this.syncFromCursor(state?.cursor ?? undefined);
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
      await this.syncFromCursor(undefined);
    } finally {
      this.running = false;
    }
  }

  private async syncFromCursor(initialCursor: string | undefined): Promise<void> {
    let cursor = initialCursor;
    let batches = 0;
    let total = 0;

    await this.index.putBootstrapState({
      status: "in_progress",
      cursor: cursor ?? null,
    });

    for (;;) {
      const page = await this.fetchPage(cursor);
      if (page.items.length === 0) {
        await this.index.putBootstrapState({ status: "complete", cursor: cursor ?? null });
        console.log(JSON.stringify({
          service: "search-indexer",
          event: "off_index_bootstrap_completed",
          indexed: total,
          resumedFrom: initialCursor ?? null,
        }));
        return;
      }

      const documents: OffSearchDocument[] = [];
      for (const item of page.items) {
        const document = toOffSearchDocument(item);
        if (document) documents.push(document);
      }

      await this.index.bulkUpsert(documents);
      total += documents.length;
      batches += 1;

      // Persist the cursor only AFTER the corresponding OpenSearch bulk succeeded.
      // If the process dies before this write, the next run safely replays that last page.
      cursor = page.nextCursor ?? undefined;
      await this.index.putBootstrapState({
        status: cursor ? "in_progress" : "complete",
        cursor: cursor ?? null,
      });

      if (!cursor) {
        console.log(JSON.stringify({
          service: "search-indexer",
          event: "off_index_bootstrap_completed",
          indexed: total,
          resumedFrom: initialCursor ?? null,
        }));
        return;
      }

      if (batches >= this.options.maxBatchesPerRun) {
        console.log(JSON.stringify({
          service: "search-indexer",
          event: "off_index_bootstrap_paused",
          indexedThisRun: total,
          batches,
          nextCursor: cursor,
        }));
        return;
      }

      await sleep(this.options.batchDelayMs);
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
          "Authorization": `Bearer ${this.options.token}`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isSourceProduct(value: unknown): value is OffSourceProduct {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.product === "object" && candidate.product !== null && !Array.isArray(candidate.product);
}
