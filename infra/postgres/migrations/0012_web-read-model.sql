-- Identity/profile and catalog read-model fields required by the web application.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS calories_per_100 numeric(8,2),
  ADD COLUMN IF NOT EXISTS protein_per_100 numeric(8,2),
  ADD COLUMN IF NOT EXISTS carbs_per_100 numeric(8,2),
  ADD COLUMN IF NOT EXISTS fat_per_100 numeric(8,2),
  ADD COLUMN IF NOT EXISTS fiber_per_100 numeric(8,2);

CREATE INDEX IF NOT EXISTS products_category_idx ON products(category) WHERE status = 'ACTIVE';
