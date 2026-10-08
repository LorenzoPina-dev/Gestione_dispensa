ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS remaining_content_quantity numeric(14,3),
  ADD COLUMN IF NOT EXISTS remaining_content_unit varchar(16);

ALTER TABLE pantry_items
  DROP CONSTRAINT IF EXISTS pantry_items_remaining_content_check;

ALTER TABLE pantry_items
  ADD CONSTRAINT pantry_items_remaining_content_check
  CHECK (
    (remaining_content_quantity IS NULL AND remaining_content_unit IS NULL)
    OR (
      remaining_content_quantity > 0
      AND remaining_content_unit IN ('g','kg','ml','l','piece')
      AND opened_at IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS pantry_items_opened_content_idx
  ON pantry_items(family_id, product_id, opened_at)
  WHERE remaining_content_quantity IS NOT NULL;
