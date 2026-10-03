# Service Catalog, Ownership & Boundaries

Questo documento è normativo. Un dominio ha **un solo owner**. Directory, worker, cache e projection non creano ownership alternativa.

## 1. Canonical services

| Service | Port | Dedicated DB | Owns | Does not own |
|---|---:|---|---|---|
| gateway | 3300 | none | edge routing, composition, request context | domain state |
| service-identity | 3310 | identity_db | profile/OIDC linkage | OIDC credentials |
| service-family | 3311 | family_db | families, members, invites, roles | user profile |
| service-inventory | 3312 | inventory_db | current pantry, lots, movement ledger | canonical products |
| service-shopping | 3313 | shopping_db | shopping lists/items | pantry state |
| service-catalog | 3314 | catalog_db | canonical products, barcodes, provenance | pantry quantities |
| service-notifications | 3315 | notifications_db | notifications/preferences | domain mutations |
| service-privacy | 3316 | privacy_db | consent/export/erasure workflow | other DBs |
| service-jobs | 3317 | jobs_db | job lifecycle, attempts, DLQ metadata | domain state |
| service-recipes | 3401 | recipes_db | recipes/suggestions | inventory mutations |
| service-nutrition | 3402 | nutrition_db | diary/targets | inventory state |
| service-stores | 3403 | stores_db | stores/prices/offers | catalog ownership |
| service-shelf-life | 3404 | shelf_life_db | rules/predictions | pantry mutations |
| service-ocr | 3405 | ocr_db | OCR jobs/drafts | catalog/inventory/stores mutations |
| off-lookup | 3200 | off_lookup_db | OpenFoodFacts cache/read-through | canonical pantry/catalog ownership |

## 2. Workers

Workers are execution processes, not domain owners.

### Runtime-enabled in this release
- worker-ocr
- worker-shelf-life

### Present but not runtime-enabled
- worker-core: legacy reconciliation still references the pre-2.0 Inventory model; it MUST NOT be started.
- worker-notifications: recipient resolution still references the pre-2.0 Family/notification model; it MUST NOT be started.
- worker-off-sync: exploratory read-through only; it is not an authoritative synchronization mechanism.
- worker-integrations: deprecated implementation under migration.
- scheduler: no executable runtime contract in this release.
- search-indexer: rebuildable projection component, not required in the request path.

A process may become runtime-enabled only after its source, DB/API boundary, migration, health contract and tests conform to this document.

A worker may write only:
1. its own execution metadata through Jobs, or
2. the DB of its domain owner through that owner's service contract.

It must never receive credentials for another service's DB.
## 3. Canonical port rule

The ports above are internal Docker/network ports. They are not browser-facing.

Only the Gateway is reachable from Nginx for application API traffic. Health/readiness endpoints remain internal.

## 4. Database isolation

Each service receives a dedicated database credential.

Forbidden:

- shared DATABASE_URL;
- shared schema;
- cross-service FK;
- cross-service JOIN;
- direct SQL to another DB;
- migration against another DB;
- shared ORM model representing another domain;
- trigger calling another service.

Allowed:

- remote UUID;
- HTTP;
- event;
- job;
- rebuildable projection.

## 5. Service API boundary

Each service exposes:

- health/live;
- health/ready;
- domain HTTP API where required;
- internal event consumer/producer;
- metrics/tracing endpoints as infrastructure requires.

The Gateway contract is the browser-facing contract. Internal service contracts follow the same validation, versioning, error, idempotency and tracing rules.

## 6. Repository naming migration

La branch contiene directory storiche oltre alle directory canoniche, ad esempio:

- `families`;
- `users`;
- `products`;
- `barcode`;
- `expiration`;
- `offers`;
- `media`;
- `vision`;
- `search`;
- `analytics`.

Queste directory non devono essere interpretate come nuovi bounded context.

Durante la migrazione:

| Storico | Canonico |
|---|---|
| users | service-identity |
| families | service-family |
| products + barcode | service-catalog |
| expiration | service-shelf-life |
| offers | service-stores |
| media + vision + OCR workflow | service-ocr + MinIO |
| analytics | projection/future analytics service |
| search + search-indexer | rebuildable search projection |
| scheduler | scheduler |
| worker-* | worker-* |

Quando la migrazione è completata, deve rimanere un solo implementation owner per ogni riga della tabella.

## 7. Deployment independence

Ogni service deve avere:

- package/build;
- Dockerfile;
- config schema;
- migrations;
- DB connection;
- health/readiness;
- unit/integration/contract tests;
- metrics/logging/tracing;
- independent restart;
- independent migration execution.

Un service non deve richiedere che un altro service sia nello stesso processo.

## 8. Future services

Nuovi bounded context possono essere aggiunti, ad esempio:

- analytics;
- recommendations;
- household automation;
- external integrations;
- advanced search.

Devono ottenere un nuovo owner e, se hanno stato authoritative, un nuovo DB dedicato. Non è consentito aggiungere tabelle a un DB esistente solo per evitare di creare il nuovo service.

## OFF product search ownership

### search-indexer

- port HTTP interne: `3210`;
- database: OpenSearch index `off-products-v1`, nessun PostgreSQL domain DB;
- owner della projection di ricerca OFF;
- non accede a MongoDB direttamente;
- riceve una source projection paginata da `off-lookup`;
- accetta upsert/reindex/search solamente sul boundary interno autenticato;
- può perdere l'indice senza perdere il corpus OFF.

### off-lookup

- port HTTP interno: `3200`;
- database: MongoDB `off_lookup_db.products`;
- owner dei documenti OFF completi e del read-through barcode cache;
- chiama OpenSearch attraverso `search-indexer` per la ricerca locale;
- chiama Search-a-licious solamente come fallback;
- notifica `search-indexer` con upsert best-effort quando apprende un prodotto dal barcode API.

### service-catalog

- non accede né a MongoDB né a OpenSearch;
- espone `GET /catalog/products/search` autenticato al Gateway;
- usa off-lookup come boundary per la ricerca;
- la selezione finale usa `POST /catalog/barcodes/resolve` e crea/persisti il prodotto applicativo nel Catalog PostgreSQL.

### Regola

`search-indexer` non diventa un nuovo owner del prodotto. Il suo indice è ricostruibile esclusivamente dalla source `off-lookup`.
