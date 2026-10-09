import type {
  LocalProductSearchClient,
  ProductIndexWriter,
} from "./product-lookup-service.js";
import type { OffSearchResult } from "./off-api-client.js";

export interface SearchIndexerClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly searchTimeoutMs: number;
  readonly writeTimeoutMs: number;
}

export class HttpSearchIndexerClient implements LocalProductSearchClient, ProductIndexWriter {
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(private readonly options: SearchIndexerClientOptions) {}

  public async search(
    query: string,
    limit: number,
    traceId?: string,
  ): Promise<OffSearchResult | undefined> {
    if (this.isCircuitOpen()) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.searchTimeoutMs);
    try {
      const url = new URL("/api/v1/off/products/search", trimBase(this.options.baseUrl));
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(Math.min(Math.max(Math.floor(limit), 1), 20)));

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Authorization": `Bearer ${this.options.token}`,
          ...(traceId ? { "X-Trace-Id": traceId } : {}),
        },
      });

      if (!response.ok) {
        this.recordFailure();
        return undefined;
      }

      const body = await response.json() as {
        items?: unknown;
      };
      const hits = Array.isArray(body.items)
        ? body.items
            .map((item) => {
              if (!item || typeof item !== "object") return undefined;
              const value = item as Record<string, unknown>;
              const code = typeof value.code === "string" ? value.code : "";
              const product = isRecord(value.product)
                ? value.product
                : isRecord(value._source)
                  ? value._source
                  : isRecord(value)
                    ? value
                    : undefined;
              if (!/^\d{8,14}$/.test(code) || !product) return undefined;
              const name =
                (typeof product.product_name_it === "string" ? product.product_name_it : "") ||
                (typeof product.product_name === "string" ? product.product_name : "");
              if (!name.trim()) return undefined;
              return { code, product };
            })
            .filter((item): item is { code: string; product: Record<string, unknown> } => item !== undefined)
        : [];

      this.recordSuccess();
      return { status: "found", hits };
    } catch {
      this.recordFailure();
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async upsert(code: string, product: Record<string, unknown>): Promise<void> {
    if (this.isCircuitOpen()) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.writeTimeoutMs);
    try {
      const response = await fetch(
        `${trimBase(this.options.baseUrl)}/api/v1/off/products/${encodeURIComponent(code)}`,
        {
          method: "PUT",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
            "Authorization": `Bearer ${this.options.token}`,
          },
          body: JSON.stringify({ code, product }),
        },
      );
      if (!response.ok) {
        this.recordFailure();
        throw new Error(`search_index_http_${response.status}`);
      }
      this.recordSuccess();
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) {
      this.circuitOpenUntil = Date.now() + 30_000;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }
}

function trimBase(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}