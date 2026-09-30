# Documentation & Implementation Conformance

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
