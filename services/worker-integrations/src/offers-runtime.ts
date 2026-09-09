import { OffersAdapter, type OfferImportResult } from "./offers.js";

export interface OffersRuntimeRepository {
  getImport(windowKey: string): Promise<OfferImportResult | undefined>;
  saveImport(windowKey: string, result: OfferImportResult): Promise<void>;
}

export class OffersRuntimeService {
  private readonly adapter: OffersAdapter;
  private readonly repository: OffersRuntimeRepository;

  public constructor(adapter: OffersAdapter, repository: OffersRuntimeRepository) {
    this.adapter = adapter;
    this.repository = repository;
  }

  public async import(input: {
    readonly windowKey: string;
    readonly area: string;
    readonly traceId: string;
  }): Promise<OfferImportResult> {
    const existing = await this.repository.getImport(input.windowKey);
    if (existing !== undefined) return existing;
    const result = await this.adapter.import(input.area, input.traceId);
    await this.repository.saveImport(input.windowKey, result);
    return result;
  }
}
