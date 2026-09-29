# Shelf Life

Rules and synchronous shelf-life prediction.

- Container port: `3404`
- Data ownership: `shelf_life_domain`
- Browser exposure: through `services/gateway` and `infra/nginx` only (except `web`, which is the root UI upstream).

## Boundary

This service owns its domain logic and persistence. Cross-service operations use HTTP or the existing Redis/job contracts; TypeScript source is never imported from another service.
