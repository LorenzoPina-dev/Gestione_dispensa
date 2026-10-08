ALTER TABLE product_food_semantics
  ADD COLUMN IF NOT EXISTS rules_version varchar(32) NOT NULL DEFAULT 'food-semantics-v2';
