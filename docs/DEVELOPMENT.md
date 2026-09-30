# Development model

## Independent builds

```bash
docker compose build inventory
docker compose up -d inventory
```

Changing `inventory` must not rebuild `shopping`, `families`, `offers`, etc.

For a service-local loop:

```bash
cd services/inventory
npm install
npm run dev
```

## Service rules

1. One bounded context per service.
2. One owner for each database.
3. No cross-service SQL.
4. No shared domain entities.
5. Shared packages are limited to contracts, config primitives and observability.
6. Synchronous calls are for immediate reads/commands; events are for propagation.
7. All public APIs are versioned.
8. Health endpoints are mandatory.
9. Tests include unit, integration and API contract tests.
10. Search and analytics data must be rebuildable.

## Implementation order

Foundation -> identity/users/families -> products/barcode -> inventory -> expiration -> shopping/stores/offers -> media/vision -> recipes/nutrition -> notifications -> search/analytics.
