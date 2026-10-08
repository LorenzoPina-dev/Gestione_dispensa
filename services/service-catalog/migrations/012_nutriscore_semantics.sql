ALTER TABLE product_food_semantics
  ADD COLUMN IF NOT EXISTS nutriscore_grade varchar(1);

ALTER TABLE product_food_semantics
  DROP CONSTRAINT IF EXISTS product_food_semantics_nutriscore_grade_ck;
ALTER TABLE product_food_semantics
  ADD CONSTRAINT product_food_semantics_nutriscore_grade_ck
  CHECK (nutriscore_grade IS NULL OR lower(nutriscore_grade) IN ('a','b','c','d','e'));
