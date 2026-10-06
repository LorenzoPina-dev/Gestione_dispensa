ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS reorder_point numeric(14,3);

ALTER TABLE pantry_items
  DROP CONSTRAINT IF EXISTS pantry_items_reorder_point_check;

ALTER TABLE pantry_items
  ADD CONSTRAINT pantry_items_reorder_point_check
  CHECK (reorder_point IS NULL OR reorder_point >= 0);

CREATE INDEX IF NOT EXISTS pantry_items_family_reorder_idx
  ON pantry_items(family_id, product_id, reorder_point);