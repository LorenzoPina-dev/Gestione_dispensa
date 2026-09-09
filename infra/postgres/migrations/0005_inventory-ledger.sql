CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('PANTRY', 'FRIDGE', 'FREEZER', 'CELLAR', 'OTHER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  product_id uuid NOT NULL REFERENCES products(id),
  package_id uuid,
  location_id uuid REFERENCES locations(id),
  current_quantity numeric(18, 6) NOT NULL CHECK (current_quantity >= 0),
  unit text NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'piece', 'pack')),
  reorder_point numeric(18, 6) CHECK (reorder_point IS NULL OR reorder_point >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_items_active_semantic_idx
  ON stock_items (family_id, product_id, COALESCE(package_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid NOT NULL REFERENCES stock_items(id),
  lot_code text,
  received_at timestamptz NOT NULL,
  expires_at timestamptz,
  opened_at timestamptz,
  quantity_snapshot numeric(18, 6) CHECK (quantity_snapshot IS NULL OR quantity_snapshot >= 0)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  stock_item_id uuid NOT NULL REFERENCES stock_items(id),
  kind text NOT NULL CHECK (kind IN ('RECEIPT', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'TRANSFER')),
  quantity numeric(18, 6) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'piece', 'pack')),
  source text NOT NULL,
  client_operation_id uuid NOT NULL,
  actor_id uuid REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (family_id, client_operation_id)
);

CREATE INDEX IF NOT EXISTS stock_movements_item_idx ON stock_movements (stock_item_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS stock_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  product_id uuid NOT NULL REFERENCES products(id),
  location_id uuid REFERENCES locations(id),
  reorder_point numeric(18, 6) NOT NULL CHECK (reorder_point >= 0),
  policy_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);