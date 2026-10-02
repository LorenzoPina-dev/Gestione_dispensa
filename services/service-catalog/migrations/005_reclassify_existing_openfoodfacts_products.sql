-- Backfill category classification for Open Food Facts products imported before the
-- category-aware classifier was added. Manual catalog categories are never overwritten.
UPDATE products AS p
SET category = CASE
  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(cand(y|ies)|confection|sugar-confectionery|bonbon|caramel|toffee|pastille|mint|lozenge)'
  ) OR p.canonical_name ~* '(caramell|caramelle|dolciumi|pastiglie|mentine|bonbon|toffee)' THEN 'confectionery-candy'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(chewing-gum|bubble-gum|gomme-a-macher|gomme à mâcher)'
  ) OR p.canonical_name ~* '(chewing gum|gomme da masticare)' THEN 'chewing-gum'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(chocolate|chocolates|cacao|cocoa)'
  ) OR p.canonical_name ~* '(cioccolat|chocolate|cacao)' THEN 'chocolate-confectionery'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(biscuit|cookie|cracker|wafer|wafers)'
  ) OR p.canonical_name ~* '(biscott|crackers|wafer)' THEN 'biscuits-crackers'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(breakfast-cereal|cereal|muesli|granola)'
  ) THEN 'breakfast-cereals'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(coffee|tea|infusion)'
  ) THEN 'coffee-tea'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(nut|peanut|seed|snack|chips|crisps|popcorn)'
  ) THEN 'nuts-snacks'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(pasta|rice|legume|pulse|flour|couscous|grain)'
  ) THEN 'dry-staples'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(canned|tomato-puree|preserve|pickle|jam|jelly|compote)'
  ) THEN 'canned-preserved'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(sauce|condiment|mustard|mayonnaise|ketchup|dressing)'
  ) THEN 'sauces-condiments'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(oil|oils|fat|olive-oil|sunflower-oil)'
  ) THEN 'oils-fats'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(water|soft-drink|soda|juice|nectar|iced-tea)'
  ) THEN 'shelf-stable-beverages'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(salt|sugar|honey)'
  ) THEN 'pantry-indefinite'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(frozen)'
  ) THEN 'frozen-general'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(meat|fish|seafood|poultry)'
  ) THEN 'fresh-meat-fish'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(fresh-pasta|fresh-dough)'
  ) THEN 'fresh-milk-pasta'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(cheese|cold-cut|charcuterie|ham)'
  ) THEN 'cold-cuts-fresh-cheese'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(dairy|yogurt|butter|milk)'
  ) THEN 'eggs-dairy'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(fruit|vegetable|salad|produce)'
  ) THEN 'produce-fresh'

  WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.openfoodfacts_raw->'categories_tags','[]'::jsonb)) AS t(value)
    WHERE lower(t.value) ~ '(bread|bakery|viennoiserie)'
  ) THEN 'bakery-fresh'

  ELSE p.category
END
WHERE lower(COALESCE(p.external_source,'')) = 'openfoodfacts'
  AND NULLIF(trim(COALESCE(p.category,'')), '') IS NULL;

INSERT INTO schema_migrations(version) VALUES ('005_reclassify_existing_openfoodfacts_products')
ON CONFLICT DO NOTHING;
