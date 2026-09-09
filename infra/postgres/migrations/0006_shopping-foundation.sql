CREATE TABLE IF NOT EXISTS shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_lists_one_active_family
  ON shopping_lists (family_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES shopping_lists(id),
  product_id uuid REFERENCES products(id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 240),
  quantity numeric(18, 6) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'piece', 'pack')),
  package_id uuid,
  state text NOT NULL DEFAULT 'SUGGESTED' CHECK (state IN ('SUGGESTED', 'ACCEPTED', 'SNOOZED', 'IGNORED', 'COMPLETED')),
  source_type text NOT NULL CHECK (source_type IN ('MANUAL', 'REORDER', 'OFFER', 'RECIPE')),
  source_ref text,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_items_active_semantic_idx
  ON shopping_items (list_id, product_id, unit, COALESCE(package_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE state <> 'COMPLETED' AND product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shopping_item_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES shopping_items(id),
  source_type text NOT NULL,
  source_ref text,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);