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

## Observability while developing

Start the platform with:

```bash
docker compose up -d
```

Operational endpoints are intentionally centralized behind the infrastructure. Grafana is the main dashboard, while Prometheus, Loki and Tempo are the backing stores. Every service exposes `/metrics` internally and Prometheus scrapes all service instances every 5 seconds in the local stack.

When diagnosing a request, start from the response `x-request-id` or `traceparent`, search the corresponding structured logs in Loki, then inspect the same trace in Tempo and latency/error counters in Prometheus.

Do not add ad-hoc `console.log` calls containing tokens, passwords, cookies, raw images or user PII. Use the service observability layer and structured fields instead.
