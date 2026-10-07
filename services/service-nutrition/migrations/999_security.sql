GRANT USAGE ON SCHEMA nutrition_domain TO nutrition_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nutrition_domain TO nutrition_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA nutrition_domain TO nutrition_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA nutrition_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nutrition_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA nutrition_domain GRANT USAGE, SELECT ON SEQUENCES TO nutrition_app;

ALTER TABLE nutrition_domain.targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_targets_user_scope ON nutrition_domain.targets;
CREATE POLICY nutrition_targets_user_scope ON nutrition_domain.targets
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE nutrition_domain.diary_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_diary_user_scope ON nutrition_domain.diary_entries;
CREATE POLICY nutrition_diary_user_scope ON nutrition_domain.diary_entries
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE nutrition_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_idempotency_scope ON nutrition_domain.idempotency_keys;
CREATE POLICY nutrition_idempotency_scope ON nutrition_domain.idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  );

ALTER TABLE nutrition_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_outbox_scope ON nutrition_domain.outbox_events;
CREATE POLICY nutrition_outbox_scope ON nutrition_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
