ALTER TABLE recipes_domain.outbox_events
  ADD COLUMN IF NOT EXISTS causation_id uuid NULL;

CREATE INDEX IF NOT EXISTS recipes_outbox_correlation_idx
  ON recipes_domain.outbox_events(correlation_id, occurred_at);

CREATE INDEX IF NOT EXISTS recipes_outbox_causation_idx
  ON recipes_domain.outbox_events(causation_id, occurred_at);