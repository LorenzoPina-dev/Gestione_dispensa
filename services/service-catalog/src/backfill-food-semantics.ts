import { PostgresClient, resolveDatabaseUrl } from "./db/postgres-client.js";
import { upsertProductFoodSemantics } from "./catalog/food-semantics-repository.js";

const BATCH_SIZE = Math.min(Math.max(Number(process.env.FOOD_SEMANTICS_BACKFILL_BATCH ?? 250), 25), 1000);

type BackfillProductRow = {
  id: string;
  canonical_name: string;
  product_details_snapshot: string | Record<string, unknown> | null;
  external_source: string | null;
  source_version: string;
};

async function main(): Promise<void> {
  const database = PostgresClient.create({ connectionString: resolveDatabaseUrl(), max: 4 });
  let lastId: string | null = null;
  let processed = 0;
  let inserted = 0;

  try {
    for (;;) {
      const rows: { readonly rows: readonly BackfillProductRow[] } = await database.query<BackfillProductRow>(
        `SELECT
           p.id,
           p.canonical_name,
           p.product_details_snapshot,
           p.external_source,
           COALESCE((
             SELECT dp.source_version
             FROM data_provenance dp
             WHERE dp.entity_type='product' AND dp.entity_id=p.id
             ORDER BY dp.observed_at DESC
             LIMIT 1
           ), CASE WHEN p.external_source IS NULL THEN 'manual-v1' ELSE 'food-semantics-v2' END) AS source_version
         FROM products p
         WHERE p.status='ACTIVE'
           AND ($1::uuid IS NULL OR p.id > $1::uuid)
         ORDER BY p.id
         LIMIT $2`,
        [lastId, BATCH_SIZE],
      );

      if (rows.rows.length === 0) break;

      for (const row of rows.rows) {
        const snapshot = typeof row.product_details_snapshot === "string"
          ? (() => {
              try { return JSON.parse(row.product_details_snapshot) as Record<string, unknown>; }
              catch { return null; }
            })()
          : row.product_details_snapshot;
        await upsertProductFoodSemantics(
          database,
          row.id,
          row.canonical_name,
          snapshot,
          row.external_source ?? "MANUAL",
          row.source_version,
        );
        processed += 1;
        inserted += 1;
      }

      lastId = rows.rows[rows.rows.length - 1]!.id;
      console.log(JSON.stringify({
        service: "catalog-food-semantics-backfill",
        event: "progress",
        processed,
        materialized: inserted,
        lastId,
      }));
    }

    console.log(JSON.stringify({
      service: "catalog-food-semantics-backfill",
      event: "completed",
      processed,
      materialized: inserted,
    }));
  } finally {
    await database.close();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    service: "catalog-food-semantics-backfill",
    event: "failed",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
