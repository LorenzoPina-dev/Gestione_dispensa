# Shelf Life

Rules and synchronous shelf-life prediction.

- Container port: `3404`
- Data ownership: `shelf_life_domain`
- Browser exposure: through `services/gateway` and `infra/nginx` only (except `web`, which is the root UI upstream).

## Rule resolution

Shelf-Life uses a deterministic specificity hierarchy:

1. product-specific profile for the exact storage/opened state;
2. category profile for the exact storage/opened state;
3. conservative category fallback when the category is known but no exact storage profile exists;
4. storage baseline for any unknown or unmapped Open Food Facts category.

The final fallback guarantees that every valid product/storage/opened combination remains processable. Manufacturer-declared expiration remains authoritative and is never replaced by an estimate.

## Boundary

This service owns its domain logic and persistence. Cross-service operations use HTTP or the existing Redis/job contracts; TypeScript source is never imported from another service.
