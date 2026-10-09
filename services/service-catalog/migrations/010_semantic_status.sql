ALTER TABLE product_food_semantics
  ADD COLUMN IF NOT EXISTS semantic_status varchar(16) NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE product_food_semantics
  DROP CONSTRAINT IF EXISTS product_food_semantics_status_check;
ALTER TABLE product_food_semantics
  ADD CONSTRAINT product_food_semantics_status_check
  CHECK (semantic_status IN ('EXACT','INFERRED','UNKNOWN','AMBIGUOUS'));
