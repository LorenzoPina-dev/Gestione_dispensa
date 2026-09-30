# Gestione Dispensa

Gestione Dispensa is a modular household food-management platform. The backend has been redesigned as independently buildable microservices; the existing `apps/web` UI is intentionally preserved unchanged in this architectural reset.

## Target architecture

- HTTPS entrypoint: NGINX `:8443`
- API Gateway: `:3000`
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

`identity`, `users`, `families`, `products`, `barcode`, `vision`, `inventory`, `expiration`, `shopping`, `stores`, `offers`, `recipes`, `nutrition`, `notifications`, `media`, `search`, `analytics`.

Workers handle OFF ingestion, image processing, offer synchronization, expiration jobs, notifications and analytics projections.

## Incremental development

Every service owns its Dockerfile, package manifest, TypeScript project and runtime. A change to `services/service-inventory` is built with:

```bash
docker compose build inventory
docker compose up -d inventory
```

It must not rebuild unrelated services.

## Important

This commit is the clean architectural baseline. Business functionality is specified in `docs/` and implemented incrementally behind stable contracts. The web UI is preserved as requested; legacy backend services and infrastructure are not retained in the new tree.
