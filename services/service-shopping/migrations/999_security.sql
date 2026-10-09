GRANT USAGE ON SCHEMA shopping_domain TO shopping_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shopping_domain TO shopping_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shopping_domain TO shopping_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shopping_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shopping_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shopping_domain GRANT USAGE, SELECT ON SEQUENCES TO shopping_app;

ALTER TABLE shopping_domain.lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_lists_scope ON shopping_domain.lists;
CREATE POLICY shopping_lists_scope ON shopping_domain.lists
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE shopping_domain.items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_items_scope ON shopping_domain.items;
CREATE POLICY shopping_items_scope ON shopping_domain.items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM shopping_domain.lists l
      WHERE l.id = shopping_domain.items.list_id
        AND l.family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shopping_domain.lists l
      WHERE l.id = shopping_domain.items.list_id
        AND l.family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    )
  );

ALTER TABLE shopping_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_outbox_scope ON shopping_domain.outbox_events;
CREATE POLICY shopping_outbox_scope ON shopping_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE shopping_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_idempotency_scope ON shopping_domain.idempotency_keys;
CREATE POLICY shopping_idempotency_scope ON shopping_domain.idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );
