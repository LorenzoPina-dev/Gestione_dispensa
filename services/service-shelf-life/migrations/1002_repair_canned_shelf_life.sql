-- Align existing databases with the realistic commercial canned-food profile.
-- Unopened commercially canned low-acid foods such as tuna are typically kept
-- for about 2-5 years in a cool, dry pantry; the manufacturer's date remains
-- authoritative for the individual product.
UPDATE shelf_life_domain.rules
SET min_days = 730,
    target_days = 1095,
    max_days = 1825,
    active = true,
    updated_at = now()
WHERE product_category = 'canned-preserved'
  AND storage = 'PANTRY'
  AND opened = false
  AND model_version = 'profiles-v2';

INSERT INTO shelf_life_domain.rules
  (product_category, storage, opened, min_days, target_days, max_days, model_version, active)
SELECT 'canned-preserved', 'PANTRY', false, 730, 1095, 1825, 'profiles-v2', true
WHERE NOT EXISTS (
  SELECT 1
  FROM shelf_life_domain.rules
  WHERE product_category = 'canned-preserved'
    AND storage = 'PANTRY'
    AND opened = false
    AND model_version = 'profiles-v2'
);

UPDATE shelf_life_domain.rules
SET min_days = 3,
    target_days = 4,
    max_days = 4,
    active = true,
    updated_at = now()
WHERE product_category = 'canned-preserved'
  AND storage = 'FRIDGE'
  AND opened = true
  AND model_version = 'profiles-v2';
