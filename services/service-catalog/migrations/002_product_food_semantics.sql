CREATE TABLE IF NOT EXISTS product_food_semantics (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  canonical_ingredient varchar(200) NULL,
  ingredient_terms text[] NOT NULL DEFAULT '{}',
  taxonomy_tags text[] NOT NULL DEFAULT '{}',
  allergen_tags text[] NOT NULL DEFAULT '{}',
  trace_tags text[] NOT NULL DEFAULT '{}',
  label_tags text[] NOT NULL DEFAULT '{}',
  dietary_tags text[] NOT NULL DEFAULT '{}',
  culinary_weight varchar(16) NOT NULL DEFAULT 'CORE',
  quantity_value numeric(14,6) NULL,
  quantity_unit varchar(16) NULL,
  quantity_base_value numeric(14,6) NULL,
  quantity_base_unit varchar(16) NULL,
  quantity_confidence numeric(5,4) NOT NULL DEFAULT 0,
  semantic_confidence numeric(5,4) NOT NULL DEFAULT 0,
  source varchar(64) NOT NULL DEFAULT 'derived',
  source_version varchar(64) NOT NULL DEFAULT 'food-semantics-v1',
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_food_semantics_weight_check CHECK (culinary_weight IN ('STAPLE','SECONDARY','CORE')),
  CONSTRAINT product_food_semantics_confidence_check CHECK (
    quantity_confidence BETWEEN 0 AND 1 AND semantic_confidence BETWEEN 0 AND 1
  )
);

CREATE INDEX IF NOT EXISTS idx_product_food_semantics_terms
  ON product_food_semantics USING gin(ingredient_terms);
CREATE INDEX IF NOT EXISTS idx_product_food_semantics_allergens
  ON product_food_semantics USING gin(allergen_tags);
CREATE INDEX IF NOT EXISTS idx_product_food_semantics_dietary
  ON product_food_semantics USING gin(dietary_tags);

INSERT INTO schema_migrations(version) VALUES ('002_product_food_semantics') ON CONFLICT DO NOTHING;
