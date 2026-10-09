# Documentation & Implementation Conformance

## Runtime base conformance gate

La baseline architecture/microservices-v2 considera la struttura architetturale completa quando tutti questi vincoli sono verificabili automaticamente:

1. Tutti i servizi canonici hanno package, Dockerfile, source, healthcheck e database proprietario quando applicabile.
2. Ogni database applicativo esegue le proprie migration al bootstrap; il bookkeeping di schema_migrations è idempotente.
3. Nessun servizio applicativo pubblica direttamente porte host; l'accesso esterno passa da Nginx -> Gateway.
4. docker compose up -d --wait completa il bootstrap senza container canonici unhealthy.
5. L'audit architetturale verifica database separation, servizi canonici, migration startup, porte, worker runtime e documentazione minima.
6. Contract audit, build/typecheck e test suite restano gate distinti: il superamento strutturale non equivale automaticamente alla verifica funzionale end-to-end.

Il gate è eseguibile con npm run architecture:audit ed è richiesto dalla CI della baseline.

## Purpose

Questo documento separa tre concetti che non devono essere confusi:

1. **Architecturally supported**: la funzione ha owner, DB, contract e flow definiti.
2. **Repository represented**: esiste una directory/candidato nella branch.
3. **Implemented and verified**: codice + migration + contract tests + integration tests dimostrano la funzione.

La presenza di una directory non è prova di implementazione.

## Architectural coverage audit

| Capability | Owner | DB | HTTP/event contract | Flow | Architectural status |
|---|---|---|---|---|---|
| Identity/profile | Identity | identity_db | yes | yes | defined |
| Families/members | Family | family_db | yes | yes | defined |
| Invites/accept/revoke | Family | family_db | yes | yes | defined |
| Pantry/current state | Inventory | inventory_db | yes | yes | defined |
| Lots/movements | Inventory | inventory_db | yes | yes | defined |
| Consume/waste/zero-delete | Inventory | inventory_db | yes | yes | defined |
| Catalog/products | Catalog | catalog_db | yes | yes | defined |
| Barcode/OFF lookup | Catalog + OFF Lookup | catalog_db + off_lookup_db | yes | yes | defined |
| Product assets | Catalog + MinIO | catalog_db | yes | yes | defined |
| Pantry image scan | OCR/Vision workflow | ocr_db | yes | yes | defined |
| Receipt OCR | OCR | ocr_db | yes | yes | defined |
| Shelf-life prediction | Shelf-Life | shelf_life_db | yes | yes | defined |
| Expiration confirmation | Inventory | inventory_db | yes | yes | defined |
| Low-stock | Inventory | inventory_db | event | yes | defined |
| Shopping | Shopping | shopping_db | yes | yes | defined |
| Stores/prices/offers | Stores | stores_db | yes | yes | defined |
| Recipes/suggestions | Recipes | recipes_db | yes | yes | defined |
| Nutrition | Nutrition | nutrition_db | yes | yes | defined |
| Notifications | Notifications | notifications_db | yes/event | yes | defined |
| Privacy consent | Privacy | privacy_db | yes | yes | defined |
| Export/erasure | Privacy + all owners | privacy_db + owner DBs | yes/event | yes | defined |
| Jobs/retry/DLQ | Jobs | jobs_db | internal/event | yes | defined |
| Dashboard composition | Gateway | none | yes | yes | defined |
| Search projection | Search Indexer | projection store | event | yes | defined |
| Future analytics | dedicated future owner | dedicated future DB | event | yes | extension point |

## Repository verification performed

The branch contains service directories for the main canonical domains and also historical directories such as users, families, products, barcode, expiration, offers, media, vision, search and analytics.

This proves repository representation, not functional completeness.

The canonical implementation must converge to the ownership table in SERVICES.md. Historical directories must be consolidated or removed before a service is considered production-ready.

## Final conformance rule

A capability is marked **implemented** only after all of the following are present:

- canonical service directory;
- dedicated DB;
- migration;
- request/response schemas;
- OpenAPI operation;
- handler/application logic;
- authorization;
- idempotency where applicable;
- optimistic concurrency where applicable;
- outbox/event schema where applicable;
- consumer deduplication where applicable;
- unit tests;
- integration tests;
- contract tests;
- failure/retry tests;
- observability;
- documentation cross-reference.

Until then its status is **defined** or **in progress**, never implemented.

## Documentation completeness

The canonical documentation set now covers:

- architecture and bounded contexts;
- service ownership;
- database-per-service;
- logical DB schema;
- local FK/index/invariant rules;
- HTTP contracts;
- OpenAPI;
- event envelope and event vocabulary;
- outbox/retry/DLQ;
- functional flows;
- security and authorization;
- network boundaries;
- operations and recovery;
- privacy/lifecycle;
- provider boundaries;
- repository structure;
- testing;
- threat model;
- requirements and acceptance criteria;
- future extension rules.

No future implementation may invent an undocumented ownership boundary or undocumented public contract.

## OFF search implementation status

| Contract | Implementation |
|---|---|
| MongoDB authoritative OFF cache | Implemented in `services/off-lookup/src/mongo-product-repository.ts` |
| Paginated internal search source | Implemented in `off-lookup` |
| OpenSearch `off-products-v1` projection | Implemented in `search-indexer/src/off-search.ts` |
| Local ranked search | Implemented in `search-indexer` + deterministic reranking |
| Search index bootstrap | Implemented and retried asynchronously |
| Explicit full reindex | Implemented |
| External Search-a-licious fallback | Implemented only after local miss/unavailability |
| Barcode exact selection path | Reuses existing Catalog barcode resolution |
| Live barcode cache -> index synchronization | Implemented best-effort |
| Manual UI name-search flow | Implemented with debounce + AbortController |
| Profile/ML reranker | Contracted as future extension; no trained model is fabricated without interaction data |

The feature is considered production-ready only after the real Docker integration/e2e gates in TEST-STRATEGY have passed.
