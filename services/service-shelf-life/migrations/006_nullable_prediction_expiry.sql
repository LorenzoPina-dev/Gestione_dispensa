-- Queued predictions do not have an expiration yet.
-- The estimate is populated only when processing completes.
ALTER TABLE shelf_life_domain.predictions
  ALTER COLUMN estimated_expires_at DROP NOT NULL;
