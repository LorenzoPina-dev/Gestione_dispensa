# Stores / Prices

Stores, product prices and price history.

- Container port: `3403`
- Data ownership: `stores_domain`
- Browser exposure: through `services/gateway` and `infra/nginx` only (except `web`, which is the root UI upstream).

## Boundary

This service owns its domain logic and persistence. Cross-service operations use HTTP or the existing Redis/job contracts; TypeScript source is never imported from another service.
