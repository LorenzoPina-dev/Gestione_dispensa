# Repository Structure

## 1. Target canonical structure

```
services/
  gateway/
  service-identity/
  service-family/
  service-inventory/
  service-shopping/
  service-catalog/
  service-notifications/
  service-privacy/
  service-jobs/
  service-recipes/
  service-nutrition/
  service-stores/
  service-shelf-life/
  service-ocr/
  off-lookup/
  worker-core/
  worker-ocr/
  worker-shelf-life/
  worker-off-sync/
  worker-notifications/
  worker-integrations/
  scheduler/
  search-indexer/

packages/
  contracts-http/
  contracts-events/
  observability/
  config/
  testing/
  technical-only/

infrastructure/
  nginx/
  keycloak/
  postgres/
  mongodb/
  redis-or-broker/
  minio/
  observability/

docs/
e2e/
scripts/
```

## 2. Service internal structure

Every domain service follows:

```
service-*/
  src/
    domain/
      entities/
      value-objects/
      policies/
    application/
      commands/
      queries/
      handlers/
    infrastructure/
      db/
      repositories/
      messaging/
      object-storage/
      providers/
    http/
      routes/
      schemas/
      middleware/
    events/
    health/
  migrations/
  contract/
    openapi.yaml
    events/
  tests/
    unit/
    integration/
    contract/
  Dockerfile
  package.json
```

The exact framework can evolve. The ownership boundaries cannot.

## 3. Shared packages

Shared packages are allowed only for technical concerns:

- logging;
- tracing;
- HTTP primitives;
- schema tooling;
- event envelope types;
- test utilities;
- configuration validation.

Forbidden in shared packages:

- PantryItem domain entity;
- Family aggregate;
- Product aggregate;
- cross-service repositories;
- shared ORM schema;
- functions that execute SQL against another service;
- business logic that silently becomes a second domain owner.

## 4. Contract source

HTTP contracts are defined in docs/API.md and docs/openapi.yaml.

Event contracts are defined in docs/EVENTS.md and service contract/event schemas.

The implementation imports generated/validated contract types where useful, but domain entities remain service-local.

## 5. Database source

Migrations live inside each service:

```
service-inventory/migrations/
service-family/migrations/
service-catalog/migrations/
...
```

A migration may connect only to its own DB.

## 6. Current repository migration state

The branch currently contains both canonical and historical service directory names. Examples include:

- users;
- families;
- products;
- barcode;
- expiration;
- offers;
- media;
- vision;
- search;
- analytics;
- scheduler;
- worker-*;
- canonical service-* directories.

These are not additional ownerships.

The implementation phase must consolidate them according to SERVICES.md so that exactly one runtime service owns each bounded context.

## 7. Naming normalization

| Existing concept | Canonical target |
|---|---|
| users | service-identity |
| families | service-family |
| inventory | service-inventory |
| shopping | service-shopping |
| products + barcode | service-catalog |
| notifications | service-notifications |
| service-privacy | service-privacy |
| service-jobs | service-jobs |
| recipes | service-recipes |
| nutrition | service-nutrition |
| stores | service-stores |
| offers | service-stores |
| expiration | service-shelf-life |
| service-shelf-life | service-shelf-life |
| service-ocr + media + vision workflow | service-ocr + MinIO |
| off-lookup | off-lookup |
| search/search-indexer | search-indexer projection |
| analytics | future projection/service |
| worker-* | workers |
| scheduler | scheduler |

## 8. Dependency rules

Allowed:

```
Gateway -> services
Service -> technical packages
Service -> own DB
Service -> object storage through technical adapter
Service -> event broker
Service -> another service through explicit HTTP contract
Worker -> owner service contract
```

Forbidden:

```
Service A -> Service B DB
Service A -> Service B ORM
Service A -> Service B domain entity
Gateway -> domain DB
Worker -> arbitrary domain DB
Shared package -> domain DB
```

## 9. Build and deploy

Every runtime service must build independently and have:

- own package;
- own image;
- own config;
- own DB connection;
- own migrations;
- own health/readiness;
- own tests.

Docker Compose may orchestrate them locally, but it must not collapse their logical ownership.

## 10. Future extension

A future service is added under services/ with its own DB if it owns authoritative state. A stateless worker may be added without a DB. A projection may use a dedicated projection store and must remain rebuildable.

No future feature is allowed to create an undocumented shared database.

## OFF search components

```text
services/
  off-lookup/
    src/
      mongo-product-repository.ts
      off-api-client.ts
      product-lookup-service.ts
      search-indexer-client.ts
      server.ts
    Dockerfile
  search-indexer/
    src/
      off-search.ts
      source-sync.ts
      server.ts
    Dockerfile
    package.json
  service-catalog/
    src/catalog/
      controller.ts
      external-barcode-client.ts
      workflow.ts
      service.ts

apps/
  web/src/
    api/
    components/AddProductModal.tsx
```

La separazione riflette i confini: OFF completo in `off-lookup`, projection/search in `search-indexer`, dominio applicativo nel Catalogo.
