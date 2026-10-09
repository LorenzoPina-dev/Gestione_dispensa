-- Preserve the unit associated with the serving quantity.
-- Example: serving_quantity=3 + serving_unit=g + serving_size="3 g".
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS serving_unit varchar(16) NULL;

INSERT INTO schema_migrations(version) VALUES ('004_serving_unit')
ON CONFLICT DO NOTHING;
