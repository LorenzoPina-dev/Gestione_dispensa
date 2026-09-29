-- Prevents duplicate rows for "the same product in the same place" -- the actual bug being
-- fixed: scanning (or manually adding) the same barcode twice used to always INSERT a second
-- stock_items row, because createStockItemAtomic never checked for an existing one first. Two
-- things were needed for the fix in services/inventory/postgres.ts to be reliable:
--
--  1. `stock_items_active_semantic_idx` (already added in 0005_inventory-ledger.sql) only
--     covers ACTIVE rows. A DEPLETED item (see 0015_stock-depletion.sql) falls outside that
--     index, so a second scan after the product ran out could insert a fresh row next to the
--     orphaned DEPLETED one instead of reactivating it. That case is handled in application code
--     (createStockItemAtomic now looks up ACTIVE-or-DEPLETED rows itself, with a `FOR UPDATE`
--     lock, before deciding to insert or merge) -- no schema change needed for it.
--  2. `locations` had NO uniqueness at all on (family_id, name): resolving the free-text
--     location "frigo" twice for the same family created two different location rows, which
--     would have defeated the stock_items semantic key (it partly keys on location_id) even
--     with fix #1 in place, since the second scan's "frigo" wouldn't match the first's. Fixed
--     here.
--
-- NOTE for a database that already has real duplicate location names: this CREATE UNIQUE INDEX
-- will fail until they're merged. On a fresh/dev database (no data yet) this is a no-op. To
-- check first: SELECT family_id, lower(name), count(*) FROM locations WHERE status='ACTIVE'
-- GROUP BY 1,2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS locations_family_name_active_idx
  ON locations (family_id, lower(name))
  WHERE status = 'ACTIVE';
