// Smoke test manuale per la stima automatica delle scadenze (shelf-life).
// Non e' parte della suite `npm test` (che usa doppi finti, non un DB reale): questo script
// parla con un Postgres vero per verificare che l'intera catena
// ShelfLifeEstimationService -> PostgresInventoryRepository -> stock_lots funzioni con lo
// schema applicato dalle migration.
//
// Uso (dopo aver fatto build e migrate, con Postgres raggiungibile da DATABASE_URL):
//   node apps/api/scripts/smoke-shelf-life.mjs
//
// Pulisce dopo di se' (nessun dato lasciato nel DB).

import { randomUUID } from "node:crypto";
import { PostgresClient, resolveDatabaseUrl } from "../dist/db/postgres-client.js";
import { ShelfLifeEstimationService } from "../dist/shelf-life/service.js";
import { PostgresShelfLifeRuleRepository } from "../dist/shelf-life/postgres.js";
import { PostgresInventoryRepository } from "../dist/inventory/postgres.js";

const db = PostgresClient.create({ connectionString: resolveDatabaseUrl() });

async function main() {
  const userId = randomUUID();
  const familyId = randomUUID();
  const productId = randomUUID();
  const stockItemId = randomUUID();

  await db.query(`INSERT INTO users (id, status) VALUES ($1, 'ACTIVE')`, [userId]);
  await db.query(
    `INSERT INTO families (id, display_name, creator_user_id, locale, timezone, unit_system, status)
     VALUES ($1, 'Smoke test', $2, 'it-IT', 'Europe/Rome', 'METRIC', 'ACTIVE')`,
    [familyId, userId],
  );
  await db.query(
    `INSERT INTO products (id, canonical_name, default_unit, status, provenance_quality, category)
     VALUES ($1, 'Petto di pollo (smoke test)', 'g', 'ACTIVE', 'VERIFIED', 'fresh-meat-fish')`,
    [productId],
  );

  const shelfLife = new ShelfLifeEstimationService(new PostgresShelfLifeRuleRepository(db));
  const inventory = new PostgresInventoryRepository(db, shelfLife);

  const stockItem = await inventory.createStockItemAtomic({
    id: stockItemId,
    familyId,
    productId,
    quantity: 500,
    unit: "g",
    location: "frigo", // -> storageKind FRIDGE
    actorId: userId,
    traceId: "smoke-test-shelf-life-0001",
    // NB: nessun expiresAt esplicito -> deve essere stimato automaticamente
  });

  const lot = await db.query(
    `SELECT expires_at, expiry_source FROM stock_lots WHERE stock_item_id = $1`,
    [stockItem.id],
  );

  console.log("Stock item creato:", { id: stockItem.id, quantity: stockItem.quantity });
  console.log("Lotto (atteso: expires_at ~ oggi+2gg, expiry_source = ESTIMATED):");
  console.table(lot.rows);

  const ok = lot.rows[0]?.expiry_source === "ESTIMATED" && lot.rows[0]?.expires_at != null;
  console.log(ok ? "\n✅ Stima automatica funzionante." : "\n❌ Nessuna stima trovata: controlla la migration 0014 e il wiring in inventory/postgres.ts.");

  // Pulizia
  await db.query(`DELETE FROM stock_lots WHERE stock_item_id = $1`, [stockItem.id]);
  await db.query(`DELETE FROM stock_items WHERE id = $1`, [stockItem.id]);
  await db.query(`DELETE FROM products WHERE id = $1`, [productId]);
  await db.query(`DELETE FROM families WHERE id = $1`, [familyId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);

  await db.close();
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
