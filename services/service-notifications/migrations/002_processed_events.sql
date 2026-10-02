CREATE TABLE IF NOT EXISTS notifications_domain.processed_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  producer varchar(128) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_processed_events_time_idx
  ON notifications_domain.processed_events(processed_at DESC);
