export type ProductUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
export type ProductQuality = "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
export type IdentifierType = "EAN8" | "EAN13" | "GTIN12" | "GTIN14" | "SKU" | "BARCODE";

export interface CreateManualProductCommand {
  canonicalName: string;
  brand?: string;
  defaultUnit: ProductUnit;
  category?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  actorId: string;
  traceId: string;
}

export interface Product {
  id: string;
  canonicalName: string;
  brand: string | undefined;
  defaultUnit: ProductUnit;
  status: "ACTIVE";
  // Widened from the original "VERIFIED"-only literal: products created from an external match
  // (see CatalogWorkflowService.resolveBarcode) are genuinely IMPORTED, and the Postgres mapping
  // was already casting across this type without it being true -- this makes the type honest.
  provenanceQuality: ProductQuality;
  version: 1;
  category?: string;
  photoUrl?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductProvenance {
  productId: string;
  source: "MANUAL";
  confidence: 1;
  observedAt: Date;
  sourceVersion: "manual-v1";
}

export interface CatalogUpdatedEvent {
  eventId: string;
  eventType: "catalog.product-updated";
  eventVersion: 1;
  aggregateType: "product";
  aggregateId: string;
  actorId: string;
  traceId: string;
  changedFields: readonly string[];
}

export interface CatalogRepository {
  listActive(): Promise<Product[]>;
  getById(productId: string): Promise<Product | undefined>;
  createManualProductAtomic(input: {
    product: Product;
    provenance: ProductProvenance;
    event: CatalogUpdatedEvent;
  }): Promise<Product>;
}

export interface CatalogIdGenerator {
  next(): string;
}

export interface CatalogClock {
  now(): Date;
}

export class CatalogValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Catalog command is invalid: ${issues.join("; ")}`);
    this.name = "CatalogValidationError";
    this.issues = issues;
  }
}

export class CatalogService {
  private readonly repository: CatalogRepository;
  private readonly ids: CatalogIdGenerator;
  private readonly clock: CatalogClock;

  public constructor(repository: CatalogRepository, ids: CatalogIdGenerator, clock: CatalogClock) {
    this.repository = repository;
    this.ids = ids;
    this.clock = clock;
  }

  public async listProducts(): Promise<Product[]> { return this.repository.listActive(); }

  public async getProduct(productId: string): Promise<Product | undefined> {
    if (!productId.trim()) throw new CatalogValidationError(["productId is required"]);
    return this.repository.getById(productId);
  }

  public async createManualProduct(command: CreateManualProductCommand): Promise<Product> {
    const canonicalName = command.canonicalName.trim();
    const issues = validate(command, canonicalName);
    if (issues.length > 0) throw new CatalogValidationError(issues);
    const productId = this.ids.next();
    const now = this.clock.now();
    return this.repository.createManualProductAtomic({
      product: {
        id: productId,
        canonicalName,
        brand: command.brand?.trim() || undefined,
        defaultUnit: command.defaultUnit,
        status: "ACTIVE",
        provenanceQuality: "VERIFIED",
        version: 1,
        ...(command.category?.trim() ? { category: command.category.trim() } : {}),
        ...(command.calories != null ? { calories: command.calories } : {}),
        ...(command.protein != null ? { protein: command.protein } : {}),
        ...(command.carbs != null ? { carbs: command.carbs } : {}),
        ...(command.fat != null ? { fat: command.fat } : {}),
        ...(command.fiber != null ? { fiber: command.fiber } : {}),
        createdAt: now,
        updatedAt: now,
      },
      provenance: {
        productId,
        source: "MANUAL",
        confidence: 1,
        observedAt: now,
        sourceVersion: "manual-v1",
      },
      event: {
        eventId: this.ids.next(),
        eventType: "catalog.product-updated",
        eventVersion: 1,
        aggregateType: "product",
        aggregateId: productId,
        actorId: command.actorId,
        traceId: command.traceId,
        changedFields: ["canonicalName", "brand", "defaultUnit"],
      },
    });
  }
}

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  const normalized = value.trim().toUpperCase();
  if (["EAN8", "EAN13", "GTIN12", "GTIN14", "BARCODE"].includes(type)) {
    const digits = normalized.replaceAll("-", "");
    const validLength = [8, 12, 13, 14].includes(digits.length);
    if (!validLength || !/^\d+$/.test(digits))
      throw new CatalogValidationError(["barcode must contain a supported numeric length"]);
    return digits;
  }
  if (normalized.length < 1 || normalized.length > 100)
    throw new CatalogValidationError(["SKU must be 1-100 characters"]);
  return normalized;
}

export function resolveImportedField<T>(
  manualValue: T | undefined,
  importedValue: T | undefined,
): T | undefined {
  return manualValue !== undefined ? manualValue : importedValue;
}

function validate(command: CreateManualProductCommand, canonicalName: string): string[] {
  const issues: string[] = [];
  if (canonicalName.length < 1 || canonicalName.length > 240)
    issues.push("canonicalName must be 1-240 characters");
  if (!command.actorId.trim()) issues.push("actorId is required");
  if (command.traceId.trim().length < 16) issues.push("traceId is required");
  if (!["g", "kg", "ml", "l", "piece", "pack"].includes(command.defaultUnit))
    issues.push("defaultUnit is invalid");
  return issues;
}
