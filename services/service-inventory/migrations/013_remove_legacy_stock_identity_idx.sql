-- The legacy security migration created pantry_items_identity_idx, which
-- treats (family, product, unit, location, lot_code) as the complete identity.
-- That contradicts batch-level inventory: two receipts of the same product may
-- have different lot_id values (including when lot_code is unknown).
--
-- 012_pantry_item_identity.sql introduced the correct physical-stock identity
-- including lot_id. Keep that index authoritative and remove the obsolete one.

DROP INDEX IF EXISTS pantry_items_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS pantry_items_identity_uq
  ON pantry_items (family_id, product_id, unit, location, lot_id, lot_code)
  NULLS NOT DISTINCT;
