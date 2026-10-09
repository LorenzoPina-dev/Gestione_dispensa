CREATE TABLE IF NOT EXISTS event_consumers (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
