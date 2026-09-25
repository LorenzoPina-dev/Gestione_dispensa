-- Depletion tracking: when a CONSUMPTION/WASTE movement brings a stock item's quantity to 0,
-- InventoryRepository.recordMovementAtomic now flips its status to DEPLETED instead of leaving
-- it ACTIVE at zero. `listByFamily` (the pantry view, GET /api/v1/inventory/stock-items) already
-- filters on status = 'ACTIVE', so a depleted item disappears from the pantry with no query
-- change there. A DEPLETED item stays individually addressable (getById, movements, and a new
-- RECEIPT movement) so restocking it reactivates the SAME row -- see
-- apps/api/src/shopping/*, which is expected to reference this row's id (not create a new
-- stock item) when a "prodotto finito" shopping item is marked as bought.
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_status_check;
ALTER TABLE stock_items
  ADD CONSTRAINT stock_items_status_check CHECK (status IN ('ACTIVE', 'DEPLETED', 'ARCHIVED'));

-- Lets the pantry-vs-shopping-list split be queried directly (see
-- PostgresInventoryRepository.listByFamilyAndStatus) instead of scanning all statuses.
CREATE INDEX IF NOT EXISTS stock_items_family_status_idx ON stock_items (family_id, status, updated_at DESC);
