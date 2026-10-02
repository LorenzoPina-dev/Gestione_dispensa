-- Baseline heuristics: estimates only, never a food-safety guarantee.
-- Generic rules ensure every supported storage/opened state can produce a prediction
-- when no more specific product-category rule is available.
INSERT INTO shelf_life_domain.rules
  (product_category, storage, opened, min_days, max_days, model_version, active)
VALUES
  (NULL, 'PANTRY', false, 30, 90, 'baseline-v1', true),
  (NULL, 'PANTRY', true, 7, 21, 'baseline-v1', true),
  (NULL, 'FRIDGE', false, 7, 21, 'baseline-v1', true),
  (NULL, 'FRIDGE', true, 2, 7, 'baseline-v1', true),
  (NULL, 'FREEZER', false, 90, 180, 'baseline-v1', true),
  (NULL, 'FREEZER', true, 30, 90, 'baseline-v1', true),
  (NULL, 'CELLAR', false, 14, 60, 'baseline-v1', true),
  (NULL, 'CELLAR', true, 7, 21, 'baseline-v1', true),
  (NULL, 'OTHER', false, 14, 60, 'baseline-v1', true),
  (NULL, 'OTHER', true, 7, 21, 'baseline-v1', true)
ON CONFLICT DO NOTHING;
