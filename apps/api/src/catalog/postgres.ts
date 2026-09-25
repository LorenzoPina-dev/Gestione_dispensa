import type {
  CatalogRepository,
  CatalogUpdatedEvent,
  IdentifierType,
  Product,
  ProductProvenance,
} from "./service.js";
import type {
  CatalogCandidateRepository,
  CatalogLookupRepository,
  ExternalProductMatch,
  ProductCandidate,
} from "./workflow.js";

export interface SqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface SqlTransaction extends SqlClient {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlTransactionFactory {
  transaction(): Promise<SqlTransaction>;
}

interface ProductRow {
  id: string;
  canonical_name: string;
  brand: string | null;
  default_unit: Product["defaultUnit"];
  status: "ACTIVE";
  provenance_quality: Product["provenanceQuality"];
  version: number;
  category?: string | null;
  photo_url?: string | null;
  calories_per_100?: string | number | null;
  protein_per_100?: string | number | null;
  carbs_per_100?: string | number | null;
  fat_per_100?: string | number | null;
  fiber_per_100?: string | number | null;
  created_at: string;
  updated_at: string;
}

export class PostgresCatalogRepository implements CatalogRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async listActive(): Promise<Product[]> {
    const result = await this.database.transaction();
    try {
      const rows = await result.query<ProductRow>(`SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality, p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, p.created_at, p.updated_at FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.status = 'ACTIVE' ORDER BY p.canonical_name ASC`);
      await result.commit(); return rows.rows.map(mapProduct);
    } catch (error) { await result.rollback(); throw error; }
  }

  public async getById(productId: string): Promise<Product | undefined> {
    const result = await this.database.transaction();
    try {
      const rows = await result.query<ProductRow>(`SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality, p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, p.created_at, p.updated_at FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = $1 AND p.status = 'ACTIVE'`, [productId]);
      await result.commit(); const row=rows.rows[0]; return row===undefined ? undefined : mapProduct(row);
    } catch (error) { await result.rollback(); throw error; }
  }

  public async createManualProductAtomic(input: {
    product: Product;
    provenance: ProductProvenance;
    event: CatalogUpdatedEvent;
  }): Promise<Product> {
    const transaction = await this.database.transaction();
    try {
      const sourceId = await ensureSource(transaction, "MANUAL", "manual");
      const brandId = await ensureBrand(transaction, input.product.brand);
      await transaction.query(
        `INSERT INTO products
          (id, canonical_name, brand_id, default_unit, status, provenance_quality, version, category, calories_per_100, protein_per_100, carbs_per_100, fat_per_100, fiber_per_100, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          input.product.id,
          input.product.canonicalName,
          brandId,
          input.product.defaultUnit,
          input.product.status,
          input.product.provenanceQuality,
          input.product.version,
          input.product.category ?? null,
          input.product.calories ?? null,
          input.product.protein ?? null,
          input.product.carbs ?? null,
          input.product.fat ?? null,
          input.product.fiber ?? null,
          input.product.createdAt,
          input.product.updatedAt,
        ],
      );
      await transaction.query(
        `INSERT INTO data_provenance
          (entity_type, entity_id, source_id, observed_at, source_version, confidence)
         VALUES ('product', $1, $2, $3, $4, $5)`,
        [
          input.provenance.productId,
          sourceId,
          input.provenance.observedAt,
          input.provenance.sourceVersion,
          input.provenance.confidence,
        ],
      );
      await insertOutbox(transaction, input.event);
      await transaction.commit();
      return input.product;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

export class PostgresCatalogLookupRepository implements CatalogLookupRepository {
  private readonly database: SqlClient & SqlTransactionFactory;

  public constructor(database: SqlClient & SqlTransactionFactory) {
    this.database = database;
  }

  public async findByIdentifier(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
  }): Promise<Product | undefined> {
    const result = await this.database.query<ProductRow>(
      `SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status,
          p.provenance_quality, p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, p.created_at, p.updated_at
       FROM product_identifiers i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE i.identifier_type = $1 AND i.normalized_value = $2
       ORDER BY i.is_verified DESC, i.created_at ASC
       LIMIT 1`,
      [input.identifierType, input.normalizedValue],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapProduct(row);
  }

  /**
   * Persists a match from an external provider (Open Food Facts today) as a real catalog
   * product and links the barcode to it, atomically, so this exact barcode is served from the
   * local `findByIdentifier` path forever after. On any failure the whole transaction rolls
   * back -- we never want a half-written product (e.g. missing its identifier link, which would
   * silently force a repeat external call on every future scan of the same code).
   */
  public async persistExternalMatch(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    match: ExternalProductMatch;
    traceId: string;
  }): Promise<Product> {
    const transaction = await this.database.transaction();
    try {
      const sourceId = await ensureSource(transaction, "PROVIDER", input.match.source);
      const brandId = await ensureBrand(transaction, input.match.brand);
      const nutritionConfidence = input.match.calories !== undefined ? "ESTIMATED" : "UNKNOWN";

      const inserted = await transaction.query<ProductRow>(
        `INSERT INTO products
          (canonical_name, brand_id, default_unit, status, provenance_quality,
           calories_per_100, protein_per_100, carbs_per_100, fat_per_100, fiber_per_100,
           nutrition_confidence, photo_url, category, external_source, external_ref, external_synced_at)
         VALUES ($1, $2, $3, 'ACTIVE', 'IMPORTED', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         RETURNING id, canonical_name, default_unit, status, provenance_quality, version,
           category, photo_url, calories_per_100, protein_per_100, carbs_per_100, fat_per_100,
           fiber_per_100, created_at, updated_at`,
        [
          input.match.canonicalName,
          brandId,
          input.match.defaultUnit,
          input.match.calories ?? null,
          input.match.protein ?? null,
          input.match.carbs ?? null,
          input.match.fat ?? null,
          input.match.fiber ?? null,
          nutritionConfidence,
          input.match.photoUrl ?? null,
          // Category is imported as-is (already normalized to our canonical vocabulary by the
          // provider, e.g. open-food-facts-provider.ts's normalizeOffCategory) so it resolves a
          // shelf-life rule immediately -- see apps/api/src/shelf-life/service.ts.
          input.match.category ?? null,
          input.match.source,
          input.match.sourceVersion,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Catalog external-match insert returned no row.");

      await transaction.query(
        `INSERT INTO product_identifiers (product_id, source_id, identifier_type, normalized_value, is_verified)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (source_id, identifier_type, normalized_value) DO NOTHING`,
        [row.id, sourceId, input.identifierType, input.normalizedValue],
      );

      await transaction.query(
        `INSERT INTO data_provenance (entity_type, entity_id, source_id, observed_at, source_version, confidence, raw_ref)
         VALUES ('product', $1, $2, now(), $3, $4, $5)`,
        [row.id, sourceId, input.match.sourceVersion, input.match.confidence, input.traceId],
      );

      await transaction.commit();
      return mapProduct({ ...row, brand: input.match.brand ?? null });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

export class PostgresCatalogCandidateRepository implements CatalogCandidateRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async applyImportedCandidate(input: {
    candidate: ProductCandidate;
    actorId: string;
    traceId: string;
  }): Promise<ProductCandidate> {
    const transaction = await this.database.transaction();
    try {
      const sourceId = await ensureSource(transaction, "PROVIDER", input.candidate.source);
      const brandId = await ensureBrand(transaction, input.candidate.brand);
      let productId = input.candidate.productId;
      if (productId === undefined) {
        const result = await transaction.query<{ id: string }>(
          `INSERT INTO products
            (canonical_name, brand_id, default_unit, status, provenance_quality)
           VALUES ($1, $2, $3, 'ACTIVE', 'IMPORTED')
           RETURNING id`,
          [input.candidate.canonicalName, brandId, input.candidate.defaultUnit],
        );
        productId = result.rows[0]?.id;
        if (productId === undefined) throw new Error("Catalog product insert returned no id.");
      }
      await transaction.query(
        `INSERT INTO data_provenance
          (entity_type, entity_id, source_id, observed_at, source_version, confidence, raw_ref)
         VALUES ('product', $1, $2, now(), $3, $4, $5)`,
        [productId, sourceId, input.candidate.source, input.candidate.confidence, input.traceId],
      );
      await transaction.commit();
      return { ...input.candidate, productId };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

async function ensureSource(
  database: SqlClient,
  kind: "MANUAL" | "PROVIDER",
  name: string,
): Promise<string> {
  const existing = await database.query<{ id: string }>(
    "SELECT id FROM data_sources WHERE kind = $1 AND name = $2 LIMIT 1",
    [kind, name],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId !== undefined) return existingId;
  const inserted = await database.query<{ id: string }>(
    "INSERT INTO data_sources (kind, name) VALUES ($1, $2) RETURNING id",
    [kind, name],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("Catalog source insert returned no id.");
  return id;
}

async function ensureBrand(database: SqlClient, brand: string | undefined): Promise<string | null> {
  if (brand === undefined || brand.trim() === "") return null;
  const normalized = brand.trim().toLocaleLowerCase("en-US");
  // Upsert atomico: evita la race SELECT-poi-INSERT (due richieste concorrenti per lo stesso
  // brand, es. React StrictMode che monta gli effect due volte, potevano entrambe superare la
  // SELECT e scontrarsi sull'INSERT, causando un 500 per violazione del vincolo unique su
  // normalized_name). ON CONFLICT rende l'operazione idempotente indipendentemente dalla
  // concorrenza.
  const upserted = await database.query<{ id: string }>(
    `INSERT INTO brands (name, normalized_name) VALUES ($1, $2)
     ON CONFLICT (normalized_name) DO UPDATE SET name = brands.name
     RETURNING id`,
    [brand.trim(), normalized],
  );
  const id = upserted.rows[0]?.id;
  if (id === undefined) throw new Error("Catalog brand insert returned no id.");
  return id;
}

async function insertOutbox(database: SqlClient, event: CatalogUpdatedEvent): Promise<void> {
  await database.query(
    `INSERT INTO outbox_events
      (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.eventId,
      event.eventType,
      event.eventVersion,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event),
    ],
  );
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    brand: row.brand ?? undefined,
    defaultUnit: row.default_unit,
    status: row.status,
    provenanceQuality: row.provenance_quality as Product["provenanceQuality"],
    version: row.version as 1,
    ...(row.category ? { category: row.category } : {}),
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
    ...(row.calories_per_100 != null ? { calories: Number(row.calories_per_100) } : {}),
    ...(row.protein_per_100 != null ? { protein: Number(row.protein_per_100) } : {}),
    ...(row.carbs_per_100 != null ? { carbs: Number(row.carbs_per_100) } : {}),
    ...(row.fat_per_100 != null ? { fat: Number(row.fat_per_100) } : {}),
    ...(row.fiber_per_100 != null ? { fiber: Number(row.fiber_per_100) } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
