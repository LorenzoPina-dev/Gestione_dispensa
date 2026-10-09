GRANT USAGE ON SCHEMA recipes_domain TO recipes_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA recipes_domain TO recipes_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA recipes_domain TO recipes_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA recipes_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recipes_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA recipes_domain GRANT USAGE, SELECT ON SEQUENCES TO recipes_app;

ALTER TABLE recipes_domain.recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_scope ON recipes_domain.recipes;
CREATE POLICY recipes_scope ON recipes_domain.recipes
  FOR ALL
  USING (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE recipes_domain.recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_ingredients_scope ON recipes_domain.recipe_ingredients;
CREATE POLICY recipes_ingredients_scope ON recipes_domain.recipe_ingredients
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM recipes_domain.recipes r
      WHERE r.id = recipes_domain.recipe_ingredients.recipe_id
        AND (r.family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
          OR r.owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes_domain.recipes r
      WHERE r.id = recipes_domain.recipe_ingredients.recipe_id
        AND (r.family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
          OR r.owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    )
  );

ALTER TABLE recipes_domain.recipe_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_steps_scope ON recipes_domain.recipe_steps;
CREATE POLICY recipes_steps_scope ON recipes_domain.recipe_steps
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM recipes_domain.recipes r
      WHERE r.id = recipes_domain.recipe_steps.recipe_id
        AND (r.family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
          OR r.owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes_domain.recipes r
      WHERE r.id = recipes_domain.recipe_steps.recipe_id
        AND (r.family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
          OR r.owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    )
  );

ALTER TABLE recipes_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_idempotency_scope ON recipes_domain.idempotency_keys;
CREATE POLICY recipes_idempotency_scope ON recipes_domain.idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );

ALTER TABLE recipes_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_outbox_scope ON recipes_domain.outbox_events;
CREATE POLICY recipes_outbox_scope ON recipes_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
