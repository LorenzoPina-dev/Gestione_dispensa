CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS recipe_catalog;
CREATE TABLE IF NOT EXISTS recipe_catalog.datasets (dataset_key varchar(128) PRIMARY KEY, source_url varchar(1000) NOT NULL, source_md5 varchar(32) NOT NULL, recipe_count integer NOT NULL DEFAULT 0, imported_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS recipe_catalog.recipes (id uuid PRIMARY KEY, source varchar(128) NOT NULL, source_recipe_id varchar(128) NOT NULL, title varchar(300) NOT NULL, category varchar(120), cost integer, difficulty integer, prep_time_minutes integer, source_url varchar(1000), quality varchar(16) NOT NULL DEFAULT 'IMPORTED', UNIQUE(source, source_recipe_id));
CREATE TABLE IF NOT EXISTS recipe_catalog.recipe_ingredients (id uuid PRIMARY KEY, recipe_id uuid NOT NULL REFERENCES recipe_catalog.recipes(id) ON DELETE CASCADE, position smallint NOT NULL, source_ingredient_id varchar(128), name varchar(300) NOT NULL, display_name varchar(300) NOT NULL, weight numeric(12,6), terms text[] NOT NULL DEFAULT '{}', UNIQUE(recipe_id, position));
CREATE TABLE IF NOT EXISTS recipe_catalog.recipe_steps (id uuid PRIMARY KEY, recipe_id uuid NOT NULL REFERENCES recipe_catalog.recipes(id) ON DELETE CASCADE, position smallint NOT NULL, instruction text NOT NULL, UNIQUE(recipe_id, position));
CREATE INDEX IF NOT EXISTS recipe_catalog_title_trgm_idx ON recipe_catalog.recipes USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS recipe_catalog_ingredient_terms_idx ON recipe_catalog.recipe_ingredients USING gin(terms);
CREATE INDEX IF NOT EXISTS recipe_catalog_ingredient_recipe_idx ON recipe_catalog.recipe_ingredients(recipe_id);
GRANT USAGE ON SCHEMA recipe_catalog TO recipes_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA recipe_catalog TO recipes_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA recipe_catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recipes_app;
