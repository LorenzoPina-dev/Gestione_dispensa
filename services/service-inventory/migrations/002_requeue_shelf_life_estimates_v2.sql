-- Invalidate derived expiration estimates so inventory items are re-estimated
-- with the current Shelf-Life profile engine. Declared dates are never touched.
-- The migration runner records the applied filename in schema_migrations.
UPDATE pantry_items
SET expires_at = NULL,
    expiration_source = NULL,
    updated_at = now(),
    version = version + 1
WHERE expiration_source = 'estimated';
