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

CREATE TEMP TABLE inventory_duplicate_items AS
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY family_id, product_id, unit, coalesce(location,''), coalesce(lot_code,'')
      ORDER BY added_at ASC, created_at ASC, id ASC
    ) AS keep_id,
    row_number() OVER (
      PARTITION BY family_id, product_id, unit, coalesce(location,''), coalesce(lot_code,'')
      ORDER BY added_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM pantry_items
)
SELECT id AS duplicate_id, keep_id
FROM ranked
WHERE rn > 1;

UPDATE pantry_items keeper
SET quantity = keeper.quantity + totals.extra_quantity,
    expires_at = COALESCE(keeper.expires_at, totals.max_expires_at),
    updated_at = now(),
    version = keeper.version + 1
FROM (
  SELECT d.keep_id,
         COALESCE(SUM(p.quantity),0) AS extra_quantity,
         MAX(p.expires_at) AS max_expires_at
  FROM inventory_duplicate_items d
  JOIN pantry_items p ON p.id = d.duplicate_id
  GROUP BY d.keep_id
) totals
WHERE keeper.id = totals.keep_id;

UPDATE movements m
SET pantry_item_id = d.keep_id
FROM inventory_duplicate_items d
WHERE m.pantry_item_id = d.duplicate_id;

DELETE FROM pantry_items p
USING inventory_duplicate_items d
WHERE p.id = d.duplicate_id;

DROP TABLE inventory_duplicate_items;

CREATE UNIQUE INDEX IF NOT EXISTS pantry_items_identity_idx
  ON pantry_items(
    family_id,
    product_id,
    unit,
    coalesce(location,''),
    coalesce(lot_code,'')
  );
