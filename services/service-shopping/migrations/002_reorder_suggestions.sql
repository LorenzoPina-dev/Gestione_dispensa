CREATE TABLE IF NOT EXISTS shopping_domain.reorder_suggestions (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(16) NOT NULL,
  reorder_point numeric(14,3) NOT NULL CHECK (reorder_point >= 0),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  source_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE(family_id, product_id)
);

CREATE TABLE IF NOT EXISTS shopping_domain.processed_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopping_reorder_suggestions_family_status_idx
  ON shopping_domain.reorder_suggestions(family_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS shopping_processed_events_time_idx
  ON shopping_domain.processed_events(processed_at DESC);
