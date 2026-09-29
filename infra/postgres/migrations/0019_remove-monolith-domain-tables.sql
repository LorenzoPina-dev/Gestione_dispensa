BEGIN;
-- recipes and stores are now owned exclusively by their domain services/schemas.
-- Migration 0018 copied the data before this destructive cleanup.
DROP TABLE IF EXISTS public.recipe_ingredients CASCADE;
DROP TABLE IF EXISTS public.recipes CASCADE;
DROP TABLE IF EXISTS public.store_prices CASCADE;
DROP TABLE IF EXISTS public.stores CASCADE;
INSERT INTO public.schema_migrations(version,name,checksum)
VALUES('0019-remove-monolith-domain-tables','remove-monolith-domain-tables','manual')
ON CONFLICT(version) DO NOTHING;
COMMIT;
