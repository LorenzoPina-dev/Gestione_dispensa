-- Optional product-specific overrides take precedence over category and generic rules.
-- product_id is a remote Catalog UUID; Shelf-Life never creates a cross-database FK.
CREATE TABLE IF NOT EXISTS shelf_life_domain.product_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  storage varchar(32) NOT NULL CHECK(storage IN ('PANTRY','FRIDGE','FREEZER','CELLAR','OTHER')),
  opened boolean NOT NULL,
  min_days integer NOT NULL CHECK(min_days >= 0),
  target_days integer NOT NULL CHECK(target_days >= min_days),
  max_days integer NOT NULL CHECK(max_days >= target_days),
  model_version varchar(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shelf_product_profiles_unique
  ON shelf_life_domain.product_profiles(product_id,storage,opened,model_version);

CREATE INDEX IF NOT EXISTS shelf_product_profiles_lookup_idx
  ON shelf_life_domain.product_profiles(product_id,storage,opened,active,created_at DESC);
