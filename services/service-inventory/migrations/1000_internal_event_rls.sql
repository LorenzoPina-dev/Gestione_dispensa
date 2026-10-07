-- Internal Inventory event consumers are authenticated by the worker
-- process deployment. A transaction-local internal flag permits applying
-- domain events across families without disabling normal family RLS.

DROP POLICY IF EXISTS inventory_pantry_items_scope ON pantry_items;
CREATE POLICY inventory_pantry_items_scope ON pantry_items
  FOR ALL
  USING (
    current_setting('app.internal_service', true) = 'true'
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.internal_service', true) = 'true'
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );

DROP POLICY IF EXISTS inventory_outbox_scope ON outbox_events;
CREATE POLICY inventory_outbox_scope ON outbox_events
  FOR ALL
  USING (
    current_setting('app.internal_service', true) = 'true'
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.internal_service', true) = 'true'
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );
