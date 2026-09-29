import {
  BarcodeCatalogAdapter,
  type BarcodeIdentifierType,
  type BarcodeLookupResult,
} from "./barcode.js";

export interface BarcodeRuntimeRequest {
  readonly jobId: string;
  readonly identifierType: BarcodeIdentifierType;
  readonly value: string;
  readonly actorId: string;
  readonly traceId: string;
}

export interface BarcodeRuntimeResult {
  readonly jobId: string;
  readonly state: BarcodeLookupResult["state"];
  readonly candidate?: BarcodeLookupResult["candidate"];
  readonly reason?: BarcodeLookupResult["reason"];
  readonly provenance: {
    readonly source: "PROVIDER" | "MANUAL";
    readonly provider?: string;
    readonly providerRequestId?: string;
    readonly observedAt?: string;
  };
}

export interface BarcodeRuntimeRepository {
  getResult(jobId: string): Promise<BarcodeRuntimeResult | undefined>;
  saveResult(result: BarcodeRuntimeResult): Promise<void>;
  recordManualFallback(input: {
    readonly jobId: string;
    readonly actorId: string;
    readonly traceId: string;
    readonly reason:
      "NOT_FOUND" | "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
  }): Promise<void>;
}

export interface BarcodeRuntimeAudit {
  append(input: {
    readonly action: "catalog.barcode.lookup";
    readonly resourceId: string;
    readonly actorId: string;
    readonly outcome: "SUCCESS" | "DEGRADED";
    readonly reason?: string;
    readonly traceId: string;
  }): Promise<void>;
}

export class BarcodeRuntimeService {
  private readonly adapter: BarcodeCatalogAdapter;
  private readonly repository: BarcodeRuntimeRepository;
  private readonly audit: BarcodeRuntimeAudit;

  public constructor(
    adapter: BarcodeCatalogAdapter,
    repository: BarcodeRuntimeRepository,
    audit: BarcodeRuntimeAudit,
  ) {
    this.adapter = adapter;
    this.repository = repository;
    this.audit = audit;
  }

  public async process(request: BarcodeRuntimeRequest): Promise<BarcodeRuntimeResult> {
    const existing = await this.repository.getResult(request.jobId);
    if (existing !== undefined) return existing;

    const lookup = await this.adapter.lookup(
      request.identifierType,
      request.value,
      request.traceId,
    );
    const candidate = lookup.candidate;
    const result: BarcodeRuntimeResult = {
      jobId: request.jobId,
      state: lookup.state,
      ...(candidate === undefined ? {} : { candidate }),
      ...(lookup.reason === undefined ? {} : { reason: lookup.reason }),
      provenance:
        candidate === undefined
          ? { source: "MANUAL" }
          : {
              source: "PROVIDER",
              provider: candidate.provider,
              providerRequestId: candidate.providerRequestId,
              observedAt: candidate.observedAt,
            },
    };
    await this.repository.saveResult(result);
    if (lookup.state !== "CANDIDATE") {
      if (lookup.reason === undefined) {
        throw new Error("Barcode fallback requires a degradation reason.");
      }
      await this.repository.recordManualFallback({
        jobId: request.jobId,
        actorId: request.actorId,
        traceId: request.traceId,
        reason: lookup.reason,
      });
    }
    await this.audit.append({
      action: "catalog.barcode.lookup",
      resourceId: request.jobId,
      actorId: request.actorId,
      outcome: lookup.state === "CANDIDATE" ? "SUCCESS" : "DEGRADED",
      ...(lookup.reason === undefined ? {} : { reason: lookup.reason }),
      traceId: request.traceId,
    });
    return result;
  }
}
