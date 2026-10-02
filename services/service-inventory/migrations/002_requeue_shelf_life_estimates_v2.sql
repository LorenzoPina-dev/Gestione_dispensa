-- Invalidate derived expiration estimates so inventory items are re-estimated
-- with the current Shelf-Life profile engine. Declared dates are never touched.
UPDATE pantry_items
SET expires_at = NULL,
    expiration_source = NULL,
    updated_at = now(),
    version = version + 1
WHERE expiration_source = 'estimated';

INSERT INTO schema_migrations(version)
VALUES ('002_requeue_shelf_life_estimates_v2.sql')
ON CONFLICT DO NOTHING;
