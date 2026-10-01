CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS recipes_domain;

CREATE TABLE IF NOT EXISTS recipes_domain.recipes (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  family_id uuid NOT NULL,
  title varchar(300) NOT NULL CHECK(length(trim(title)) > 0),
  servings numeric(8,2) NOT NULL CHECK(servings > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recipes_domain.recipe_ingredients (
  id uuid PRIMARY KEY,
  recipe_id uuid NOT NULL REFERENCES recipes_domain.recipes(id) ON DELETE CASCADE,
  product_id uuid NULL,
  name varchar(300) NOT NULL CHECK(length(trim(name)) > 0),
  quantity numeric(14,3) NOT NULL CHECK(quantity > 0),
  unit varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipes_domain.recipe_steps (
  id uuid PRIMARY KEY,
  recipe_id uuid NOT NULL REFERENCES recipes_domain.recipes(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position > 0),
  instruction text NOT NULL,
  UNIQUE(recipe_id,position)
);

CREATE TABLE IF NOT EXISTS recipes_domain.idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('processing','completed','failed')),
  response_status integer NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes_domain.outbox_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  aggregate_id uuid NOT NULL,
  family_id uuid NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_family_created_idx ON recipes_domain.recipes(family_id,created_at DESC);
CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_idx ON recipes_domain.recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS recipes_outbox_publish_idx ON recipes_domain.outbox_events(published_at,created_at);
