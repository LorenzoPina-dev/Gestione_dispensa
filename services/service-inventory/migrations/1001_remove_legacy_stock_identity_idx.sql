-- The security migration runs at 999 and may recreate the legacy identity
-- index. This cleanup therefore runs after all security migrations.
DROP INDEX IF EXISTS pantry_items_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS pantry_items_identity_uq
  ON pantry_items (family_id, product_id, unit, location, lot_id, lot_code)
  NULLS NOT DISTINCT;
