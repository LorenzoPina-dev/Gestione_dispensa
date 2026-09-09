export type OfferQuality = "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";

export interface OfferProviderContext {
  readonly traceId: string;
  readonly signal: AbortSignal;
}

export interface ProviderOffer {
  readonly offerId: string;
  readonly productId: string | null;
  readonly retailerId: string;
  readonly area: string;
  readonly price: number;
  readonly currency: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly sourceQuality: OfferQuality;
}

export interface OfferProvider {
  fetch(
    area: string,
    context: OfferProviderContext,
  ): Promise<{
    readonly provider: string;
    readonly sourceVersion: string;
    readonly offers: readonly ProviderOffer[];
  }>;
}

export interface ImportedOffer extends ProviderOffer {
  readonly provider: string;
  readonly sourceVersion: string;
  readonly importedAt: string;
}

export interface OfferImportResult {
  readonly state: "IMPORTED" | "STALE" | "DEGRADED" | "EMPTY";
  readonly offers: readonly ImportedOffer[];
  readonly reason?: "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "INVALID_SOURCE";
}

export class OfferProviderError extends Error {
  public readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED";

  public constructor(code: OfferProviderError["code"], message: string) {
    super(message);
    this.name = "OfferProviderError";
    this.code = code;
  }
}

export class OffersAdapter {
  private readonly provider: OfferProvider;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  public constructor(options: { provider: OfferProvider; timeoutMs: number; now?: () => number }) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new Error("Offers adapter timeout must be a positive integer.");
    }
    this.provider = options.provider;
    this.timeoutMs = options.timeoutMs;
    this.now = options.now ?? Date.now;
  }

  public async import(area: string, traceId: string): Promise<OfferImportResult> {
    if (!area.trim() || traceId.trim().length < 16) {
      throw new Error("Offer import requires area and traceId.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await Promise.race([
        this.provider.fetch(area.trim(), { traceId, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new OfferProviderError("PROVIDER_TIMEOUT", "Offer provider timed out.")),
            this.timeoutMs,
          );
        }),
      ]);
      const importedAt = new Date(this.now()).toISOString();
      const offers = response.offers.filter((offer) => isValidOffer(offer, area));
      const active = offers
        .filter(
          (offer) =>
            Date.parse(offer.validFrom) <= this.now() && Date.parse(offer.validTo) > this.now(),
        )
        .map((offer) => ({
          ...offer,
          provider: response.provider,
          sourceVersion: response.sourceVersion,
          importedAt,
        }));
      if (active.length === 0) {
        return { state: offers.length === 0 ? "EMPTY" : "STALE", offers: [] };
      }
      return { state: "IMPORTED", offers: active };
    } catch (error: unknown) {
      if (error instanceof OfferProviderError) {
        return { state: "DEGRADED", offers: [], reason: error.code };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isValidOffer(offer: ProviderOffer, requestedArea: string): boolean {
  return (
    offer.area === requestedArea.trim() &&
    Number.isFinite(offer.price) &&
    offer.price >= 0 &&
    /^[A-Z]{3}$/.test(offer.currency) &&
    Number.isFinite(Date.parse(offer.validFrom)) &&
    Number.isFinite(Date.parse(offer.validTo)) &&
    Date.parse(offer.validTo) > Date.parse(offer.validFrom) &&
    offer.retailerId.trim().length > 0
  );
}
