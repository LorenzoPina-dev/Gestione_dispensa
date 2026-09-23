-- Recipes are shared reference data (not family-scoped), matching the demo recipe catalog's
-- structure in apps/web/src/mockData.ts.
CREATE TABLE IF NOT EXISTS recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  source text,
  quality text NOT NULL DEFAULT 'UNKNOWN' CHECK (quality IN ('VERIFIED', 'IMPORTED', 'ESTIMATED', 'UNKNOWN')),
  servings integer NOT NULL CHECK (servings > 0),
  time_minutes integer NOT NULL CHECK (time_minutes > 0),
  difficulty text NOT NULL CHECK (difficulty IN ('Facile', 'Medio', 'Difficile')),
  image text,
  tags text[] NOT NULL DEFAULT '{}',
  calories_per_serving integer,
  steps text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipes(id),
  -- Nullable: an ingredient can be named without being tied to a catalog product (matches the
  -- demo data, e.g. "Pomodori ciliegini" in the frittata recipe has no stockItemId).
  product_id uuid REFERENCES products(id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  amount numeric(18, 6) NOT NULL CHECK (amount > 0),
  unit text NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'piece', 'pack')),
  allergens text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_idx ON recipe_ingredients (recipe_id, position);
