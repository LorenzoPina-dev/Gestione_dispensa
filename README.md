# Gestione Dispensa

Gestione Dispensa is a modular household food-management platform. The backend has been redesigned as independently buildable microservices; the existing `apps/web` UI is intentionally preserved unchanged in this architectural reset.

## Target architecture

- HTTPS entrypoint: NGINX `:8443`
- API Gateway interno: `:3300` (esposto al browser solo tramite NGINX `:8443`)
- Keycloak for identity
- One bounded-context service per domain
- Database ownership per service
- PostgreSQL for transactional domain data
- MongoDB for the Open Food Facts catalog/cache
- Redis for cache, locks and short-lived state
- Kafka for asynchronous domain events
- MinIO for images, receipts and ML datasets
- OpenSearch for derived search indexes
- Prometheus/Grafana/Loki/OpenTelemetry for observability

## Backend services

Canonical services:

`service-identity`, `service-family`, `service-inventory`, `service-catalog`, `service-shopping`, `service-recipes`, `service-nutrition`, `service-stores`, `service-notifications`, `service-ocr`, `service-shelf-life`, `service-privacy`, `service-jobs`, plus `off-lookup`.

Workers currently runnable in the baseline:

`worker-ocr` and `worker-shelf-life`.

Additional worker/search runtimes may be added only when their consumer contract and executable runtime are present; they are not treated as active services merely because source packages exist.
## Incremental development

Every service owns its Dockerfile, package manifest, TypeScript project and runtime. Each service owns its Dockerfile, package manifest, TypeScript project, migration set and runtime. For example:

```bash
docker compose build service-inventory
docker compose up -d service-inventory
```

It must not rebuild unrelated services.

## Important

This commit is the clean architectural baseline. Business functionality is specified in `docs/` and implemented incrementally behind stable contracts. The web UI is preserved as requested; legacy backend services and infrastructure are not retained in the new tree.
