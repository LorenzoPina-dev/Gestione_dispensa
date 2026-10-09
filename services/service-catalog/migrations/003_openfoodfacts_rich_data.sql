-- Preserve normalized package/image fields and the complete upstream Open Food Facts document.
-- The raw JSON is intentionally retained so newly introduced OFF fields remain available
-- without requiring a Catalog schema migration for every provider field.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS quantity_value numeric(12,3) NULL,
  ADD COLUMN IF NOT EXISTS quantity_unit varchar(16) NULL,
  ADD COLUMN IF NOT EXISTS quantity_label varchar(120) NULL,
  ADD COLUMN IF NOT EXISTS serving_size varchar(120) NULL,
  ADD COLUMN IF NOT EXISTS serving_quantity numeric(12,3) NULL,
  ADD COLUMN IF NOT EXISTS images_json jsonb NULL,
  ADD COLUMN IF NOT EXISTS openfoodfacts_raw jsonb NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_products_external_source_ref
  ON products(external_source, external_ref);

INSERT INTO schema_migrations(version) VALUES ('003_openfoodfacts_rich_data')
ON CONFLICT DO NOTHING;
