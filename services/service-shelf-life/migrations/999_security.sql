GRANT USAGE ON SCHEMA shelf_life_domain TO shelf_life_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shelf_life_domain TO shelf_life_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shelf_life_domain TO shelf_life_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shelf_life_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shelf_life_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shelf_life_domain GRANT USAGE, SELECT ON SEQUENCES TO shelf_life_app;

ALTER TABLE shelf_life_domain.predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shelf_life_predictions_scope ON shelf_life_domain.predictions;
CREATE POLICY shelf_life_predictions_scope ON shelf_life_domain.predictions
  FOR ALL
  USING (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE shelf_life_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shelf_life_idempotency_scope ON shelf_life_domain.idempotency_keys;
CREATE POLICY shelf_life_idempotency_scope ON shelf_life_domain.idempotency_keys
  FOR ALL
  USING (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE shelf_life_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shelf_life_outbox_scope ON shelf_life_domain.outbox_events;
CREATE POLICY shelf_life_outbox_scope ON shelf_life_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
