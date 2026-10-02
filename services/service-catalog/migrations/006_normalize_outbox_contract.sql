-- Normalize the legacy Catalog outbox to the common event envelope.
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS schema_version integer,
  ADD COLUMN IF NOT EXISTS family_id uuid NULL,
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS causation_id uuid NULL;

UPDATE outbox_events
SET schema_version = COALESCE(schema_version, event_version),
    correlation_id = COALESCE(correlation_id, gen_random_uuid())
WHERE schema_version IS NULL OR correlation_id IS NULL;

ALTER TABLE outbox_events
  ALTER COLUMN schema_version SET NOT NULL,
  ALTER COLUMN correlation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_outbox_unpublished
  ON outbox_events(published_at, created_at);
