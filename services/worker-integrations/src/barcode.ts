export type BarcodeIdentifierType = "EAN8" | "EAN13" | "GTIN12" | "GTIN14" | "BARCODE";
export type ImportedQuality = "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";

export interface BarcodeProviderContext {
  readonly traceId: string;
  readonly signal: AbortSignal;
}

export interface BarcodeProviderProduct {
  readonly canonicalName: string;
  readonly brand?: string;
  readonly defaultUnit?: "g" | "kg" | "ml" | "l" | "piece" | "pack";
}

export interface BarcodeProviderResponse {
  readonly provider: string;
  readonly providerRequestId: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
  readonly quality: ImportedQuality;
  readonly confidence: number;
  readonly product?: BarcodeProviderProduct;
  readonly warnings: readonly string[];
}

export interface BarcodeProvider {
  lookup(identifier: string, context: BarcodeProviderContext): Promise<BarcodeProviderResponse>;
}

export interface BarcodeCandidate {
  readonly identifier: string;
  readonly provider: string;
  readonly providerRequestId: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
  readonly quality: ImportedQuality;
  readonly confidence: number;
  readonly product: BarcodeProviderProduct;
  readonly warnings: readonly string[];
  readonly reviewRequired: true;
}

export interface BarcodeLookupResult {
  readonly state: "CANDIDATE" | "MANUAL_REQUIRED" | "DEGRADED";
  readonly candidate?: BarcodeCandidate;
  readonly reason?:
    "NOT_FOUND" | "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
}

export interface BarcodeAdapterOptions {
  readonly provider: BarcodeProvider;
  readonly timeoutMs: number;
  readonly now?: () => number;
}

export class BarcodeProviderError extends Error {
  public readonly retryable: boolean;
  public readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";

  public constructor(code: BarcodeProviderError["code"], message: string, retryable: boolean) {
    super(message);
    this.name = "BarcodeProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class BarcodeCatalogAdapter {
  private readonly provider: BarcodeProvider;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  public constructor(options: BarcodeAdapterOptions) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new Error("Barcode adapter timeout must be a positive integer.");
    }
    this.provider = options.provider;
    this.timeoutMs = options.timeoutMs;
    this.now = options.now ?? Date.now;
  }

  public async lookup(
    identifierType: BarcodeIdentifierType,
    value: string,
    traceId: string,
  ): Promise<BarcodeLookupResult> {
    const identifier = normalizeBarcode(identifierType, value);
    if (traceId.trim().length < 16) {
      throw new Error("Barcode lookup requires a traceId.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await Promise.race([
        this.provider.lookup(identifier, { traceId, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new BarcodeProviderError(
                  "PROVIDER_TIMEOUT",
                  "Barcode provider exceeded its deadline.",
                  true,
                ),
              ),
            this.timeoutMs,
          );
        }),
      ]);
      if (response.product === undefined) {
        return { state: "MANUAL_REQUIRED", reason: "NOT_FOUND" };
      }
      validateResponse(response);
      return {
        state: "CANDIDATE",
        candidate: {
          identifier,
          provider: response.provider,
          providerRequestId: response.providerRequestId,
          sourceVersion: response.sourceVersion,
          observedAt: response.observedAt,
          quality: response.quality,
          confidence: response.confidence,
          product: response.product,
          warnings: response.warnings,
          reviewRequired: true,
        },
      };
    } catch (error: unknown) {
      if (error instanceof BarcodeProviderError) {
        return { state: "DEGRADED", reason: error.code };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  public telemetry(): Readonly<Record<string, unknown>> {
    return {
      provider: this.provider.constructor.name || "provider",
      timeoutMs: this.timeoutMs,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }
}

export function normalizeBarcode(type: BarcodeIdentifierType, value: string): string {
  const normalized = value.trim().replaceAll("-", "");
  const lengths: Record<BarcodeIdentifierType, number[]> = {
    EAN8: [8],
    EAN13: [13],
    GTIN12: [12],
    GTIN14: [14],
    BARCODE: [8, 12, 13, 14],
  };
  if (!lengths[type].includes(normalized.length) || !/^\d+$/.test(normalized)) {
    throw new Error("Barcode must contain a supported numeric length.");
  }
  return normalized;
}

function validateResponse(response: BarcodeProviderResponse): void {
  if (!response.provider.trim() || !response.providerRequestId.trim()) {
    throw new BarcodeProviderError(
      "PROVIDER_UNAVAILABLE",
      "Provider response is missing correlation metadata.",
      false,
    );
  }
  if (!Number.isFinite(response.confidence) || response.confidence < 0 || response.confidence > 1) {
    throw new BarcodeProviderError(
      "PROVIDER_UNAVAILABLE",
      "Provider response confidence is invalid.",
      false,
    );
  }
  if (!Number.isFinite(Date.parse(response.observedAt))) {
    throw new BarcodeProviderError(
      "PROVIDER_UNAVAILABLE",
      "Provider response timestamp is invalid.",
      false,
    );
  }
  if (!response.product?.canonicalName.trim()) {
    throw new BarcodeProviderError(
      "PROVIDER_UNAVAILABLE",
      "Provider response product is invalid.",
      false,
    );
  }
}
