import type { IdentifierType, ProductUnit } from "./service.js";
import type { ExternalBarcodeLookupClient, ExternalProductMatch } from "./workflow.js";

export interface HttpExternalBarcodeLookupClientOptions {
  /** e.g. http://worker-integrations:3100 (internal Docker network address). */
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Consecutive failures before the breaker opens and skips calling the worker outright. */
  readonly circuitBreakThreshold?: number;
  /** How long the breaker stays open before trying the worker again. */
  readonly circuitResetMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

interface WorkerLookupResponseBody {
  readonly state?: string;
  readonly candidate?: {
    readonly provider?: string;
    readonly sourceVersion?: string;
    readonly confidence?: number;
    readonly product?: {
      readonly canonicalName?: string;
      readonly brand?: string;
      readonly defaultUnit?: string;
      readonly photoUrl?: string;
      readonly calories?: number;
      readonly protein?: number;
      readonly carbs?: number;
      readonly fat?: number;
      readonly fiber?: number;
    };
  };
}

const KNOWN_UNITS: readonly ProductUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];

/**
 * Calls the worker-integrations service (a separate Docker container that wraps Open Food
 * Facts). This client is built to NEVER throw and NEVER let a slow/unreachable worker slow down
 * or fail a barcode lookup:
 *  - every request has its own hard timeout (`timeoutMs`);
 *  - every failure mode (network error, timeout, non-2xx status, malformed JSON, an unexpected
 *    shape) is caught and converted into `undefined` -- "no external match available";
 *  - a tiny circuit breaker skips calling the worker for a cool-down window after repeated
 *    failures, so a genuinely down dependency degrades to instant "no match" instead of every
 *    request queueing up behind the same timeout.
 * CatalogWorkflowService treats `undefined` as "fall back to manual entry", which is exactly
 * the behaviour we want when this worker (or Open Food Facts itself) is unavailable.
 */
export class HttpExternalBarcodeLookupClient implements ExternalBarcodeLookupClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly circuitBreakThreshold: number;
  private readonly circuitResetMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(options: HttpExternalBarcodeLookupClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.circuitBreakThreshold = options.circuitBreakThreshold ?? 5;
    this.circuitResetMs = options.circuitResetMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  public async lookup(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    traceId: string;
  }): Promise<ExternalProductMatch | undefined> {
    if (this.now() < this.circuitOpenUntil) {
      // Breaker open: the worker has been failing repeatedly, so fail fast without a network
      // call rather than making every barcode scan wait out the full timeout.
      return undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/internal/v1/barcode/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifierType: input.identifierType,
          value: input.normalizedValue,
          traceId: input.traceId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.recordFailure();
        return undefined;
      }

      const body = (await response.json()) as WorkerLookupResponseBody;
      this.recordSuccess();
      return toExternalMatch(body);
    } catch {
      // Network error, timeout (AbortError), or a body that wasn't valid JSON -- all degrade
      // silently to "no external match", never propagate.
      this.recordFailure();
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitBreakThreshold) {
      this.circuitOpenUntil = this.now() + this.circuitResetMs;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }
}

function toExternalMatch(body: WorkerLookupResponseBody): ExternalProductMatch | undefined {
  if (body.state !== "CANDIDATE") return undefined;
  const product = body.candidate?.product;
  const canonicalName = product?.canonicalName?.trim();
  if (!canonicalName) return undefined;

  const defaultUnit = KNOWN_UNITS.includes(product?.defaultUnit as ProductUnit)
    ? (product?.defaultUnit as ProductUnit)
    : "piece";
  const confidence = body.candidate?.confidence;

  return {
    canonicalName,
    ...(product?.brand ? { brand: product.brand } : {}),
    defaultUnit,
    ...(product?.photoUrl ? { photoUrl: product.photoUrl } : {}),
    ...(product?.calories !== undefined ? { calories: product.calories } : {}),
    ...(product?.protein !== undefined ? { protein: product.protein } : {}),
    ...(product?.carbs !== undefined ? { carbs: product.carbs } : {}),
    ...(product?.fat !== undefined ? { fat: product.fat } : {}),
    ...(product?.fiber !== undefined ? { fiber: product.fiber } : {}),
    source: body.candidate?.provider ?? "openfoodfacts",
    sourceVersion: body.candidate?.sourceVersion ?? "unknown",
    confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0.7,
  };
}
