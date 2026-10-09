import {
  CatalogVersionConflictError,
  type CatalogRepository,
  type CatalogUpdatedEvent,
  type IdentifierType,
  type Product,
  type ProductProvenance,
} from "./service.js";
import { deriveProductFoodSemantics } from "./food-semantics.js";
import { upsertProductFoodSemantics } from "./food-semantics-repository.js";
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
  quantity_value?: string | number | null;
  quantity_unit?: Product["quantityUnit"] | null;
  quantity_label?: string | null;
  serving_size?: string | null;
  serving_quantity?: string | number | null;
  serving_unit?: string | null;
  images_json?: string | Record<string, unknown> | null;
  product_details_snapshot?: string | Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  barcodes_json?: string | null;
  external_source?: string | null;
  external_ref?: string | null;
  food_semantics_json?: string | null;
}

export class PostgresCatalogRepository implements CatalogRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async listActive(): Promise<Product[]> {
    const result = await this.database.transaction();
    try {
      const rows = await result.query<ProductRow>(`SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality, p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size, p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at, COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id = p.id), '[]') AS barcodes_json, p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.status = 'ACTIVE' ORDER BY p.canonical_name ASC`);
      await result.commit(); return rows.rows.map(mapProduct);
    } catch (error) { await result.rollback(); throw error; }
  }

  public async getProductsByIds(productIds: readonly string[]): Promise<Product[]> {
    if (productIds.length === 0) return [];
    const result = await this.database.transaction();
    try {
      const rows = await result.query<ProductRow>(
        `SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality, p.version,
                p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100,
                p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size,
                p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at,
                COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text
                          FROM product_identifiers i2 WHERE i2.product_id = p.id), '[]') AS barcodes_json,
                p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
          WHERE p.id = ANY($1::uuid[]) AND p.status = 'ACTIVE'`,
        [Array.from(new Set(productIds))],
      );
      await result.commit();
      return rows.rows.map(mapProduct);
    } catch (error) {
      await result.rollback();
      throw error;
    }
  }

  public async getById(productId: string): Promise<Product | undefined> {
    const result = await this.database.transaction();
    try {
      const rows = await result.query<ProductRow>(`SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality, p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size, p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at,
        COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id = p.id), '[]') AS barcodes_json,
        p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
        FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = $1 AND p.status = 'ACTIVE'`, [productId]);
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
      for (const barcode of input.product.barcodes) {
        await transaction.query(
          `INSERT INTO product_identifiers
            (product_id, source_id, identifier_type, normalized_value, is_verified)
           VALUES ($1, $2, 'BARCODE', $3, true)
           ON CONFLICT DO NOTHING`,
          [input.product.id, sourceId, barcode],
        );
      }
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
      await upsertProductFoodSemantics(
        transaction,
        input.product.id,
        input.product.canonicalName,
        input.product.openFoodFacts ?? {
          productName: input.product.canonicalName,
          quantityValue: input.product.quantityValue,
          quantityUnit: input.product.quantityUnit,
        },
        "MANUAL",
        input.provenance.sourceVersion,
        input.provenance.observedAt,
      );
      await insertOutbox(transaction, input.event);
      await transaction.commit();
      return input.product;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  public async updateProductAtomic(input: {
    productId: string;
    expectedVersion: number;
    patch: { name?: string; brand?: string | null; category?: string | null; imageObjectKey?: string | null; nutrition?: Record<string, unknown> | null };
    event: CatalogUpdatedEvent;
  }): Promise<Product | undefined> {
    const transaction = await this.database.transaction();
    try {
      const current = await transaction.query<ProductRow>(
        `SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality,
          p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size, p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at,
          COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id=p.id),'[]') AS barcodes_json,
          p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
         FROM products p LEFT JOIN brands b ON b.id=p.brand_id
         WHERE p.id=$1 AND p.status='ACTIVE' FOR UPDATE OF p`,
        [input.productId],
      );
      const row = current.rows[0];
      if (!row) {
        await transaction.rollback();
        return undefined;
      }
      if (row.version !== input.expectedVersion) {
        await transaction.rollback();
        throw new CatalogVersionConflictError();
      }

      const nutrition = input.patch.nutrition;
      const kcal = nutrition && typeof nutrition.kcalPer100g === "number" ? nutrition.kcalPer100g : null;
      const protein = nutrition && typeof nutrition.proteinGPer100g === "number" ? nutrition.proteinGPer100g : null;
      const carbs = nutrition && typeof nutrition.carbsGPer100g === "number" ? nutrition.carbsGPer100g : null;
      const fat = nutrition && typeof nutrition.fatGPer100g === "number" ? nutrition.fatGPer100g : null;
      const fiber = nutrition && typeof nutrition.fiberGPer100g === "number" ? nutrition.fiberGPer100g : null;
      const brandId = Object.hasOwn(input.patch, "brand")
        ? await ensureBrand(transaction, input.patch.brand ?? undefined)
        : undefined;

      await transaction.query(
        `UPDATE products SET
          canonical_name=CASE WHEN $2 THEN $3 ELSE canonical_name END,
          brand_id=CASE WHEN $4 THEN $5 ELSE brand_id END,
          category=CASE WHEN $6 THEN $7 ELSE category END,
          photo_url=CASE WHEN $8 THEN $9 ELSE photo_url END,
          calories_per_100=CASE WHEN $10 THEN $11 ELSE calories_per_100 END,
          protein_per_100=CASE WHEN $12 THEN $13 ELSE protein_per_100 END,
          carbs_per_100=CASE WHEN $14 THEN $15 ELSE carbs_per_100 END,
          fat_per_100=CASE WHEN $16 THEN $17 ELSE fat_per_100 END,
          fiber_per_100=CASE WHEN $18 THEN $19 ELSE fiber_per_100 END,
          updated_at=now(), version=version+1
         WHERE id=$1`,
        [
          input.productId,
          Object.hasOwn(input.patch,"name"), input.patch.name ?? null,
          Object.hasOwn(input.patch,"brand"), brandId ?? null,
          Object.hasOwn(input.patch,"category"), input.patch.category ?? null,
          Object.hasOwn(input.patch,"imageObjectKey"), input.patch.imageObjectKey ?? null,
          kcal !== null, kcal,
          protein !== null, protein,
          carbs !== null, carbs,
          fat !== null, fat,
          fiber !== null, fiber,
        ],
      );
      const fresh = await transaction.query<ProductRow>(
        `SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality,
          p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size, p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at,
          COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id=p.id),'[]') AS barcodes_json,
          p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
         FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.id=$1`,
        [input.productId],
      );
      if (fresh.rows[0]) {
        const currentSnapshot = parseJsonObject(fresh.rows[0].product_details_snapshot);
        const materializedSemantics = await upsertProductFoodSemantics(
          transaction,
          input.productId,
          fresh.rows[0].canonical_name,
          currentSnapshot,
          fresh.rows[0].external_source ?? "MANUAL",
          undefined,
          new Date(),
        );
        fresh.rows[0].food_semantics_json = JSON.stringify(materializedSemantics);
      }

      await insertOutbox(transaction, input.event);
      await transaction.commit();
      return fresh.rows[0] ? mapProduct(fresh.rows[0]) : undefined;
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
          p.provenance_quality, p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size, p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at,
          COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id=p.id),'[]') AS barcodes_json,
          p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
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
      await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["catalog-barcode:" + input.identifierType + ":" + input.normalizedValue]);
      const existing = await transaction.query<ProductRow>("SELECT p.id,p.canonical_name,b.name AS brand,p.default_unit,p.status,p.provenance_quality,p.version,p.category,p.photo_url,p.calories_per_100,p.protein_per_100,p.carbs_per_100,p.fat_per_100,p.fiber_per_100,p.quantity_value,p.quantity_unit,p.quantity_label,p.serving_size,p.serving_quantity,p.images_json,p.product_details_snapshot,p.created_at,p.updated_at,COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id=p.id),'[]') AS barcodes_json,p.external_source,p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json FROM product_identifiers i JOIN products p ON p.id=i.product_id LEFT JOIN brands b ON b.id=p.brand_id WHERE i.identifier_type=$1 AND i.normalized_value=$2 AND p.status=$3 LIMIT 1", [input.identifierType, input.normalizedValue, "ACTIVE"]);
      if (existing.rows[0]) {
        const current = mapProduct(existing.rows[0]);
        await transaction.commit();
        // A manual product remains authoritative. For an existing OpenFoodFacts projection,
        // reconcile it in a fresh transaction so an older partial snapshot cannot survive forever.
        if (current.externalSource?.trim().toLowerCase() === "openfoodfacts") {
          return this.refreshExternalMatch(input);
        }
        return current;
      }
      const sourceId = await ensureSource(transaction, "PROVIDER", input.match.source);
      const brandId = await ensureBrand(transaction, input.match.brand);
      const nutritionConfidence = input.match.calories !== undefined ? "ESTIMATED" : "UNKNOWN";

      const inserted = await transaction.query<ProductRow>(
        `INSERT INTO products
          (canonical_name, brand_id, default_unit, status, provenance_quality,
           calories_per_100, protein_per_100, carbs_per_100, fat_per_100, fiber_per_100,
           nutrition_confidence, photo_url, category, external_source, external_ref, external_synced_at,
           quantity_value, quantity_unit, quantity_label, serving_size, serving_quantity, serving_unit, images_json, product_details_snapshot)
         VALUES ($1, $2, $3, 'ACTIVE', 'IMPORTED', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb)
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
          // shelf-life rule immediately -- see services/inventory/shelf-life-client.ts.
          input.match.category ?? null,
          input.match.source,
          input.match.sourceRef ?? input.normalizedValue,
          input.match.quantityValue ?? null,
          input.match.quantityUnit ?? null,
          input.match.quantityLabel ?? null,
          input.match.servingSize ?? null,
          input.match.servingQuantity ?? null,
          input.match.servingUnit ?? null,
          JSON.stringify(input.match.images ?? null),
          JSON.stringify(curateProductDetails(input.match.openFoodFacts)),
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Catalog external-match insert returned no row.");

      await upsertProductFoodSemantics(
        transaction,
        row.id,
        input.match.canonicalName,
        input.match.openFoodFacts ?? {
          productName: input.match.canonicalName,
          quantityValue: input.match.quantityValue,
          quantityUnit: input.match.quantityUnit,
        },
        input.match.source,
        input.match.sourceVersion,
      );

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

      const fresh = await transaction.query<ProductRow>(
        `SELECT p.id, p.canonical_name, b.name AS brand, p.default_unit, p.status, p.provenance_quality,
          p.version, p.category, p.photo_url, p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100, p.quantity_value, p.quantity_unit, p.quantity_label, p.serving_size, p.serving_quantity, p.serving_unit, p.images_json, p.product_details_snapshot, p.created_at, p.updated_at,
          COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2 WHERE i2.product_id=p.id),'[]') AS barcodes_json,
          p.external_source, p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
         FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.id=$1`,
        [row.id],
      );
      await insertOutbox(transaction, {
        eventId: crypto.randomUUID(),
        eventType: "ProductCreated",
        eventVersion: 1,
        aggregateType: "product",
        aggregateId: row.id,
        // This ProductCreated event is generated by the service itself, not by a user.
        // outbox_events.actor_id is nullable UUID, so system events must use NULL.
        actorId: null,
        traceId: input.traceId,
        payload: {
          productId: row.id,
          name: input.match.canonicalName,
          brand: input.match.brand ?? null,
          category: input.match.category ?? null,
          barcodes: [input.normalizedValue],
        },
      });
      await transaction.commit();
      return fresh.rows[0] ? mapProduct(fresh.rows[0]) : mapProduct({ ...row, brand: input.match.brand ?? null });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async refreshExternalMatch(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    match: ExternalProductMatch;
    traceId: string;
  }): Promise<Product> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        ["catalog-barcode:" + input.identifierType + ":" + input.normalizedValue],
      );

      const existing = await transaction.query<ProductRow>(
        `SELECT p.id,p.canonical_name,b.name AS brand,p.default_unit,p.status,p.provenance_quality,
          p.version,p.category,p.photo_url,p.calories_per_100,p.protein_per_100,p.carbs_per_100,p.fat_per_100,
          p.fiber_per_100,p.quantity_value,p.quantity_unit,p.quantity_label,p.serving_size,p.serving_quantity,
          p.serving_unit,p.images_json,p.product_details_snapshot,p.created_at,p.updated_at,
          COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2
            WHERE i2.product_id=p.id),'[]') AS barcodes_json,
          p.external_source,p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
         FROM product_identifiers i
         JOIN products p ON p.id=i.product_id
         LEFT JOIN brands b ON b.id=p.brand_id
         WHERE i.identifier_type=$1 AND i.normalized_value=$2 AND p.status='ACTIVE'
         LIMIT 1`,
        [input.identifierType, input.normalizedValue],
      );
      const row = existing.rows[0];
      if (!row) {
        await transaction.rollback();
        throw new Error("Cannot refresh missing Catalog product.");
      }

      const current = mapProduct(row);
      if (current.externalSource?.trim().toLowerCase() !== "openfoodfacts") {
        await transaction.commit();
        return current;
      }

      const sourceId = await ensureSource(transaction, "PROVIDER", input.match.source);
      const brandId = await ensureBrand(transaction, input.match.brand);
      const nutritionConfidence = input.match.calories !== undefined ? "ESTIMATED" : "UNKNOWN";

      await transaction.query(
        `UPDATE products SET
          canonical_name=$2,
          brand_id=$3,
          default_unit=$4,
          provenance_quality='IMPORTED',
          calories_per_100=$5,
          protein_per_100=$6,
          carbs_per_100=$7,
          fat_per_100=$8,
          fiber_per_100=$9,
          nutrition_confidence=$10,
          photo_url=$11,
          category=$12,
          external_source=$13,
          external_ref=$14,
          external_synced_at=now(),
          quantity_value=$15,
          quantity_unit=$16,
          quantity_label=$17,
          serving_size=$18,
          serving_quantity=$19,
          serving_unit=$20,
          images_json=$21::jsonb,
          product_details_snapshot=$22::jsonb,
          updated_at=now(),
          version=version+1
         WHERE id=$1 AND status='ACTIVE'`,
        [
          row.id,
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
          input.match.category ?? null,
          input.match.source,
          input.match.sourceRef ?? input.normalizedValue,
          input.match.quantityValue ?? null,
          input.match.quantityUnit ?? null,
          input.match.quantityLabel ?? null,
          input.match.servingSize ?? null,
          input.match.servingQuantity ?? null,
          input.match.servingUnit ?? null,
          JSON.stringify(input.match.images ?? null),
          JSON.stringify(curateProductDetails(input.match.openFoodFacts)),
        ],
      );

      await upsertProductFoodSemantics(
        transaction,
        row.id,
        input.match.canonicalName,
        input.match.openFoodFacts ?? {
          productName: input.match.canonicalName,
          quantityValue: input.match.quantityValue,
          quantityUnit: input.match.quantityUnit,
        },
        input.match.source,
        input.match.sourceVersion,
      );

      await transaction.query(
        `INSERT INTO data_provenance
          (entity_type, entity_id, source_id, observed_at, source_version, confidence, raw_ref)
         VALUES ('product', $1, $2, now(), $3, $4, $5)`,
        [row.id, sourceId, input.match.sourceVersion, input.match.confidence, input.traceId],
      );

      await insertOutbox(transaction, {
        eventId: crypto.randomUUID(),
        eventType: "ProductEnriched",
        eventVersion: 1,
        aggregateType: "product",
        aggregateId: row.id,
        actorId: null,
        traceId: input.traceId,
        changedFields: [
          "canonicalName", "brand", "defaultUnit", "category", "nutrition",
          "quantity", "serving", "images", "productDetailsSnapshot",
        ],
        payload: {
          productId: row.id,
          source: input.match.source,
          sourceRef: input.match.sourceRef ?? input.normalizedValue,
          sourceVersion: input.match.sourceVersion,
        },
      });

      const fresh = await transaction.query<ProductRow>(
        `SELECT p.id,p.canonical_name,b.name AS brand,p.default_unit,p.status,p.provenance_quality,
          p.version,p.category,p.photo_url,p.calories_per_100,p.protein_per_100,p.carbs_per_100,p.fat_per_100,
          p.fiber_per_100,p.quantity_value,p.quantity_unit,p.quantity_label,p.serving_size,p.serving_quantity,
          p.serving_unit,p.images_json,p.product_details_snapshot,p.created_at,p.updated_at,
          COALESCE((SELECT json_agg(i2.normalized_value ORDER BY i2.created_at)::text FROM product_identifiers i2
            WHERE i2.product_id=p.id),'[]') AS barcodes_json,
          p.external_source,p.external_ref, public.product_food_semantics_json(p.id)::text AS food_semantics_json
         FROM products p
         LEFT JOIN brands b ON b.id=p.brand_id
         WHERE p.id=$1`,
        [row.id],
      );

      await transaction.commit();
      return fresh.rows[0] ? mapProduct(fresh.rows[0]) : current;
    } catch (error) {
      try { await transaction.rollback(); } catch { /* transaction may already be closed */ }
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
      (event_id, event_type, event_version, schema_version, aggregate_type, aggregate_id, actor_id, trace_id, family_id, correlation_id, causation_id, occurred_at, payload)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, NULL, $9, NULL, now(), $8::jsonb)`
    , [
      event.eventId,
      event.eventType,
      event.eventVersion,
      event.aggregateType,
      event.aggregateId,
      event.actorId,
      event.traceId,
      JSON.stringify(event.payload),
      crypto.randomUUID(),
    ]
  );
}
function mapProduct(row: ProductRow): Product {
  const materialized = parseJsonObject(row.food_semantics_json);
  const materializedSemantics = materialized && materialized.rulesVersion === "food-semantics-v2"
    ? materialized as unknown as Product["foodSemantics"]
    : null;
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    brand: row.brand ?? undefined,
    defaultUnit: row.default_unit,
    status: row.status,
    provenanceQuality: row.provenance_quality as Product["provenanceQuality"],
    version: Number(row.version),
    ...(row.category ? { category: row.category } : {}),
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
    ...(row.calories_per_100 != null ? { calories: Number(row.calories_per_100) } : {}),
    ...(row.protein_per_100 != null ? { protein: Number(row.protein_per_100) } : {}),
    ...(row.carbs_per_100 != null ? { carbs: Number(row.carbs_per_100) } : {}),
    ...(row.fat_per_100 != null ? { fat: Number(row.fat_per_100) } : {}),
    ...(row.fiber_per_100 != null ? { fiber: Number(row.fiber_per_100) } : {}),
    ...(row.quantity_value != null ? { quantityValue: Number(row.quantity_value) } : {}),
    ...(row.quantity_unit ? { quantityUnit: row.quantity_unit } : {}),
    ...(row.quantity_label ? { quantityLabel: row.quantity_label } : {}),
    ...(row.serving_size ? { servingSize: row.serving_size } : {}),
    ...(row.serving_quantity != null ? { servingQuantity: Number(row.serving_quantity) } : {}),
    ...(row.serving_unit ? { servingUnit: row.serving_unit } : {}),
    ...(parseJsonObject(row.images_json) ? { images: parseJsonObject(row.images_json) } : {}),
    ...(parseJsonObject(row.product_details_snapshot) ? { openFoodFacts: parseJsonObject(row.product_details_snapshot) } : {}),
    foodSemantics: materializedSemantics ?? deriveProductFoodSemantics(row.id, parseJsonObject(row.product_details_snapshot), row.canonical_name),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    barcodes: row.barcodes_json ? JSON.parse(row.barcodes_json) as string[] : [],
    ...(row.external_source ? { externalSource: row.external_source } : {}),
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
  };
}


function curateProductDetails(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const allowed: Record<string, string> = {
    ingredients_text: "ingredientsText",
    ingredients_text_it: "ingredientsTextIt",
    allergens_tags: "allergensTags",
    traces_tags: "tracesTags",
    labels_tags: "labelsTags",
    categories_tags: "categoriesTags",
    countries_tags: "countriesTags",
    stores_tags: "storesTags",
    packaging: "packaging",
    origins: "origins",
    nutriscore_grade: "nutriScoreGrade",
    nova_group: "novaGroup",
    ecoscore_grade: "ecoScoreGrade",
  };
  const snapshot: Record<string, unknown> = {};
  for (const [source, target] of Object.entries(allowed)) {
    if (raw[source] !== undefined && raw[source] !== null) snapshot[target] = raw[source];
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function parseJsonObject(value: string | Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
