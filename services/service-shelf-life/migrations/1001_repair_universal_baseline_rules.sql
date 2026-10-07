-- Repair migration for installations where the original baseline migration
-- was already recorded as applied before the universal fallback rules were added.
-- These rows are the final DB-level safety net: every supported storage/opened
-- combination must remain processable even for arbitrary Open Food Facts categories.

-- First repair any existing generic baseline rows. This intentionally does not
-- rely on ON CONFLICT inference because the legacy uniqueness is an expression
-- index (coalesce(product_category,''), storage, opened, model_version).
UPDATE shelf_life_domain.rules
SET min_days = CASE
      WHEN storage='PANTRY' AND opened=false THEN 30
      WHEN storage='PANTRY' AND opened=true THEN 7
      WHEN storage='FRIDGE' AND opened=false THEN 7
      WHEN storage='FRIDGE' AND opened=true THEN 2
      WHEN storage='FREEZER' AND opened=false THEN 90
      WHEN storage='FREEZER' AND opened=true THEN 30
      WHEN storage='CELLAR' AND opened=false THEN 14
      WHEN storage='CELLAR' AND opened=true THEN 7
      WHEN storage='OTHER' AND opened=false THEN 14
      WHEN storage='OTHER' AND opened=true THEN 7
      ELSE min_days
    END,
    target_days = CASE
      WHEN storage='PANTRY' AND opened=false THEN 60
      WHEN storage='PANTRY' AND opened=true THEN 14
      WHEN storage='FRIDGE' AND opened=false THEN 14
      WHEN storage='FRIDGE' AND opened=true THEN 4
      WHEN storage='FREEZER' AND opened=false THEN 135
      WHEN storage='FREEZER' AND opened=true THEN 60
      WHEN storage='CELLAR' AND opened=false THEN 30
      WHEN storage='CELLAR' AND opened=true THEN 14
      WHEN storage='OTHER' AND opened=false THEN 30
      WHEN storage='OTHER' AND opened=true THEN 14
      ELSE target_days
    END,
    max_days = CASE
      WHEN storage='PANTRY' AND opened=false THEN 90
      WHEN storage='PANTRY' AND opened=true THEN 21
      WHEN storage='FRIDGE' AND opened=false THEN 21
      WHEN storage='FRIDGE' AND opened=true THEN 7
      WHEN storage='FREEZER' AND opened=false THEN 180
      WHEN storage='FREEZER' AND opened=true THEN 90
      WHEN storage='CELLAR' AND opened=false THEN 60
      WHEN storage='CELLAR' AND opened=true THEN 21
      WHEN storage='OTHER' AND opened=false THEN 60
      WHEN storage='OTHER' AND opened=true THEN 21
      ELSE max_days
    END,
    active = true,
    updated_at = now()
WHERE product_category IS NULL
  AND model_version='baseline-v1';

-- Then add whichever generic states are missing. DO NOTHING is sufficient here:
-- it does not require an explicit conflict target.
INSERT INTO shelf_life_domain.rules
  (product_category, storage, opened, min_days, target_days, max_days, model_version, active)
VALUES
  (NULL, 'PANTRY', false, 30, 60, 90, 'baseline-v1', true),
  (NULL, 'PANTRY', true, 7, 14, 21, 'baseline-v1', true),
  (NULL, 'FRIDGE', false, 7, 14, 21, 'baseline-v1', true),
  (NULL, 'FRIDGE', true, 2, 4, 7, 'baseline-v1', true),
  (NULL, 'FREEZER', false, 90, 135, 180, 'baseline-v1', true),
  (NULL, 'FREEZER', true, 30, 60, 90, 'baseline-v1', true),
  (NULL, 'CELLAR', false, 14, 30, 60, 'baseline-v1', true),
  (NULL, 'CELLAR', true, 7, 14, 21, 'baseline-v1', true),
  (NULL, 'OTHER', false, 14, 30, 60, 'baseline-v1', true),
  (NULL, 'OTHER', true, 7, 14, 21, 'baseline-v1', true)
ON CONFLICT DO NOTHING;
