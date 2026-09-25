import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Outcome of a live Open Food Facts API call, kept deliberately separate from HTTP semantics:
 *  - "found": the barcode exists on Open Food Facts; `product` is the raw product object exactly
 *    as OFF returns it, so it can be stored locally in the same shape as a bulk-imported dump row.
 *  - "not_found": OFF positively confirmed this barcode does not exist in its database. This is
 *    the ONLY case that should ever become an HTTP 404 to our callers.
 *  - "error": the call could not be completed (network failure, timeout, rate limit, 5xx,
 *    malformed payload). Absence here is NOT confirmed -- callers must not treat this as 404.
 */
export type OffApiResult =
  | { readonly status: "found"; readonly product: Record<string, unknown> }
  | { readonly status: "not_found" }
  | { readonly status: "error"; readonly reason: string; readonly retryable: boolean };

export interface OffApiClient {
  fetchProduct(barcode: string): Promise<OffApiResult>;
  isCircuitOpen(): boolean;
}

interface OffV3Response {
  // v3 uses a string status ("success" | "failure" | ...); older mirrors/tests may still send the
  // v2-style numeric 0/1. Both are handled defensively.
  readonly status?: string | number;
  readonly product?: Record<string, unknown>;
}

/**
 * Thin client for the public Open Food Facts v3 product API
 * (https://world.openfoodfacts.org/api/v3/product/{barcode}.json). No API key required.
 *
 * Fault tolerance:
 *  - every request has its own hard timeout (`config.offApi.timeoutMs`) via AbortController;
 *  - every failure mode (network error, timeout, non-2xx, unparsable JSON) is converted into a
 *    typed `{ status: "error" }` result, never thrown;
 *  - a small circuit breaker opens after `maxConsecutiveFailures` in a row and skips the network
 *    call entirely for `cooldownMs`, so a genuinely down Open Food Facts degrades to instant
 *    "error" results instead of every request queueing behind the same timeout.
 */
export class OpenFoodFactsApiClient implements OffApiClient {
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  public async fetchProduct(barcode: string): Promise<OffApiResult> {
    if (this.isCircuitOpen()) {
      return { status: "error", reason: "circuit_open", retryable: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.offApi.timeoutMs);
    try {
      const url = `${config.offApi.baseUrl.replace(/\/+$/, "")}/api/v3/product/${encodeURIComponent(barcode)}.json`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": config.offApi.userAgent, Accept: "application/json" },
      });

      if (response.status === 404) {
        this.recordSuccess();
        return { status: "not_found" };
      }
      if (response.status === 429) {
        this.recordFailure();
        return { status: "error", reason: "rate_limited", retryable: true };
      }
      if (!response.ok) {
        this.recordFailure();
        return { status: "error", reason: `http_${response.status}`, retryable: response.status >= 500 };
      }

      const body = (await response.json()) as OffV3Response;
      this.recordSuccess();

      const found = body.status === "success" || body.status === 1;
      if (found && body.product && Object.keys(body.product).length > 0) {
        return { status: "found", product: body.product };
      }
      return { status: "not_found" };
    } catch (error) {
      this.recordFailure();
      const reason = controller.signal.aborted
        ? "timeout"
        : error instanceof Error
          ? error.message
          : "network_error";
      return { status: "error", reason, retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= config.offApi.maxConsecutiveFailures) {
      this.circuitOpenUntil = Date.now() + config.offApi.cooldownMs;
      log("error", "off_api_circuit_open", {
        cooldownMs: config.offApi.cooldownMs,
        resumesAt: new Date(this.circuitOpenUntil).toISOString(),
      });
    }
  }
}
