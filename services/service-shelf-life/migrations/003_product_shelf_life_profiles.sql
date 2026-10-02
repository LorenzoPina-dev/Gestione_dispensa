-- Product-category shelf-life profiles.
-- The stored target is the recommended estimate inside the min/max uncertainty window.
-- These are heuristics for unopened/adequately stored products; a manufacturer-declared date
-- always remains authoritative and the user can override the estimate.
ALTER TABLE shelf_life_domain.rules
  ADD COLUMN IF NOT EXISTS target_days integer NULL;

-- Complete the legacy baseline rules created by 002.
UPDATE shelf_life_domain.rules
SET target_days = CASE
  WHEN product_category IS NULL AND storage='PANTRY' AND opened=false THEN 60
  WHEN product_category IS NULL AND storage='PANTRY' AND opened=true THEN 14
  WHEN product_category IS NULL AND storage='FRIDGE' AND opened=false THEN 14
  WHEN product_category IS NULL AND storage='FRIDGE' AND opened=true THEN 4
  WHEN product_category IS NULL AND storage='FREEZER' AND opened=false THEN 135
  WHEN product_category IS NULL AND storage='FREEZER' AND opened=true THEN 60
  WHEN product_category IS NULL AND storage='CELLAR' AND opened=false THEN 30
  WHEN product_category IS NULL AND storage='CELLAR' AND opened=true THEN 14
  WHEN product_category IS NULL AND storage='OTHER' AND opened=false THEN 30
  WHEN product_category IS NULL AND storage='OTHER' AND opened=true THEN 14
  ELSE target_days
END
WHERE model_version='baseline-v1' AND target_days IS NULL;

-- Fresh / chilled foods.
INSERT INTO shelf_life_domain.rules(product_category,storage,opened,min_days,target_days,max_days,model_version,active) VALUES
('fresh-meat-fish','FRIDGE',false,1,2,3,'profiles-v2',true),
('fresh-meat-fish','FRIDGE',true,1,1,2,'profiles-v2',true),
('fresh-meat-fish','FREEZER',false,60,120,180,'profiles-v2',true),
('fresh-meat-fish','FREEZER',true,30,60,90,'profiles-v2',true),
('fresh-milk-pasta','FRIDGE',false,2,5,7,'profiles-v2',true),
('fresh-milk-pasta','FRIDGE',true,1,3,5,'profiles-v2',true),
('cold-cuts-fresh-cheese','FRIDGE',false,7,14,30,'profiles-v2',true),
('cold-cuts-fresh-cheese','FRIDGE',true,3,7,14,'profiles-v2',true),
('eggs-dairy','FRIDGE',false,5,14,30,'profiles-v2',true),
('eggs-dairy','FRIDGE',true,2,7,14,'profiles-v2',true),
('produce-fresh','FRIDGE',false,2,7,14,'profiles-v2',true),
('produce-fresh','FRIDGE',true,1,4,7,'profiles-v2',true),
('produce-fresh','PANTRY',false,1,3,7,'profiles-v2',true),
('produce-fresh','PANTRY',true,1,2,4,'profiles-v2',true),
('bakery-fresh','PANTRY',false,1,3,5,'profiles-v2',true),
('bakery-fresh','PANTRY',true,1,2,3,'profiles-v2',true),
('bakery-fresh','FRIDGE',false,2,5,7,'profiles-v2',true),
('bakery-fresh','FRIDGE',true,1,3,5,'profiles-v2',true),

-- Shelf-stable foods.
('confectionery-candy','PANTRY',false,540,730,1095,'profiles-v2',true),
('confectionery-candy','PANTRY',true,90,180,365,'profiles-v2',true),
('chewing-gum','PANTRY',false,365,730,1095,'profiles-v2',true),
('chewing-gum','PANTRY',true,60,180,365,'profiles-v2',true),
('chocolate-confectionery','PANTRY',false,180,270,365,'profiles-v2',true),
('chocolate-confectionery','PANTRY',true,30,90,180,'profiles-v2',true),
('biscuits-crackers','PANTRY',false,180,270,365,'profiles-v2',true),
('biscuits-crackers','PANTRY',true,30,60,120,'profiles-v2',true),
('breakfast-cereals','PANTRY',false,180,270,365,'profiles-v2',true),
('breakfast-cereals','PANTRY',true,30,60,90,'profiles-v2',true),
('coffee-tea','PANTRY',false,180,270,365,'profiles-v2',true),
('coffee-tea','PANTRY',true,30,90,180,'profiles-v2',true),
('nuts-snacks','PANTRY',false,120,240,365,'profiles-v2',true),
('nuts-snacks','PANTRY',true,30,60,120,'profiles-v2',true),
('dry-staples','PANTRY',false,365,540,730,'profiles-v2',true),
('dry-staples','PANTRY',true,60,180,365,'profiles-v2',true),
('canned-preserved','PANTRY',false,365,730,1095,'profiles-v2',true),
('canned-preserved','FRIDGE',true,3,5,7,'profiles-v2',true),
('sauces-condiments','PANTRY',false,180,365,540,'profiles-v2',true),
('sauces-condiments','FRIDGE',true,14,30,60,'profiles-v2',true),
('oils-fats','PANTRY',false,365,540,730,'profiles-v2',true),
('oils-fats','PANTRY',true,180,365,540,'profiles-v2',true),
('shelf-stable-beverages','PANTRY',false,120,270,365,'profiles-v2',true),
('shelf-stable-beverages','FRIDGE',true,2,5,7,'profiles-v2',true),
('pantry-indefinite','PANTRY',false,730,1095,1825,'profiles-v2',true),
('pantry-indefinite','PANTRY',true,180,365,730,'profiles-v2',true),

-- Frozen packaged foods.
('frozen-general','FREEZER',false,90,180,365,'profiles-v2',true),
('frozen-general','FREEZER',true,30,90,180,'profiles-v2',true)
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES ('003_product_shelf_life_profiles')
ON CONFLICT DO NOTHING;
