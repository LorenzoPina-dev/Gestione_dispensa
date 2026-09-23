-- Nutrition values are stored per 100 base units (100g for g/kg products, 100ml for ml/l
-- products). Products measured in "piece"/"pack" have no defined per-100-base-unit value, so
-- their nutrient columns stay NULL and nutrition calculations are skipped for them (see
-- nutrition/service.ts NutritionService.getSummary).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS calories_per_100 numeric(8, 2),
  ADD COLUMN IF NOT EXISTS protein_per_100 numeric(8, 2),
  ADD COLUMN IF NOT EXISTS carbs_per_100 numeric(8, 2),
  ADD COLUMN IF NOT EXISTS fat_per_100 numeric(8, 2),
  ADD COLUMN IF NOT EXISTS fiber_per_100 numeric(8, 2),
  ADD COLUMN IF NOT EXISTS nutrition_confidence text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (nutrition_confidence IN ('CONFIRMED', 'ESTIMATED', 'UNKNOWN'));
