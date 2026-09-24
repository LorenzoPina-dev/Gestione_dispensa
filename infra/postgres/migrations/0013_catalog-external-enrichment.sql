-- Adds storage for data coming from external barcode enrichment (photo + provenance
-- bookkeeping). Nutrient columns already exist (see 0010_nutrition.sql); this migration only
-- adds what was missing to fully cache an Open-Food-Facts (or any future provider) match locally,
-- so a barcode only ever needs to hit the external API once.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref text,
  ADD COLUMN IF NOT EXISTS external_synced_at timestamptz;

-- Lets us find "this barcode already came from provider X" quickly if we ever need to
-- re-sync/refresh a previously imported product instead of re-deriving it from product_identifiers.
CREATE INDEX IF NOT EXISTS products_external_source_idx
  ON products (external_source, external_ref)
  WHERE external_source IS NOT NULL;
