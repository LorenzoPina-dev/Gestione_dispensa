ALTER TABLE product_food_semantics
  ADD COLUMN IF NOT EXISTS components_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS composition_confidence numeric(5,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS product_food_semantics_components_gin
  ON product_food_semantics USING gin(components_json);
