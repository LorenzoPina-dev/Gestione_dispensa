GRANT USAGE ON SCHEMA public TO inventory_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inventory_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO inventory_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inventory_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO inventory_app;

ALTER TABLE pantry_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_pantry_lots_scope ON pantry_lots;
CREATE POLICY inventory_pantry_lots_scope ON pantry_lots
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_pantry_items_scope ON pantry_items;
CREATE POLICY inventory_pantry_items_scope ON pantry_items
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_movements_scope ON movements;
CREATE POLICY inventory_movements_scope ON movements
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_outbox_scope ON outbox_events;
CREATE POLICY inventory_outbox_scope ON outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_idempotency_scope ON idempotency_keys;
CREATE POLICY inventory_idempotency_scope ON idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );


ALTER TABLE reorder_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_reorder_policies_scope ON reorder_policies;
CREATE POLICY inventory_reorder_policies_scope ON reorder_policies
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

CREATE UNIQUE INDEX IF NOT EXISTS pantry_items_identity_idx
  ON pantry_items(
    family_id,
    product_id,
    unit,
    coalesce(location,''),
    coalesce(lot_code,'')
  );
