# Matrice di tracciabilita ingegneristica

La matrice collega requisiti, componenti, contratti e prove. Gli ID dei requisiti sono definiti in [Requisiti di prodotto e sistema](REQUIREMENTS.md).

| Area | Requisiti | Componenti | Contratti/eventi | Prove minime |
|---|---|---|---|---|
| Identity/household | FR-001..005, NFR-001..003 | Gateway, Identity, Audit | auth DTO, membership policy | login, deny, revoca, tenant isolation |
| Family/QR join | FR-006..012, FR-080..081, NFR-002/007/011/016 | Family service, Gateway, Identity, Web/PWA, Audit | family invite API, family.* events, join state | create, scan, login redirect, accept, revoke, replay, expiry |
| Catalog/barcode | FR-013..018 | Catalog, Recognition, Integration worker | Product, recognition.completed, catalog.updated | barcode known/unknown, conflict, review |
| Inventory | FR-020..025, NFR-002..005 | API, Inventory, Worker core | Stock, Movement, received/consumed | ledger, duplicate, concurrency, restore |
| Shopping | FR-030..034 | Shopping, Worker core, Notification | reorder-point, shopping DTO | threshold, dedupe, concurrent edit |
| Search | FR-040..043, NFR-004..006 | Search indexer, Catalog, Inventory read model | product update event | ranking, lag, rebuild, access scope |
| Recipes | FR-050..053 | Recipe, Catalog, Nutrition | recipe suggestion event | allergen hard filter, source, AI fallback |
| Nutrition | FR-052..054, NFR-007 | Nutrition, Catalog, Consumption | nutrition profile | portion, unknown source, erase |
| Offers | FR-060..063 | Offers, Integration worker, Shopping | offer.imported | stale, 429, matching, license |
| Async/reliability | FR-070..074, NFR-003/005/010 | Broker, workers, Outbox, DLQ | event envelope, job state | retry, poison, replay, backpressure |
| Observability | NFR-006/010 | OTel, Prometheus, Grafana, Loki, Tempo, Alertmanager | telemetry fields | trace E2E, alert drill, redaction |
| Privacy/profile | NFR-007, fuori perimetro | Profile worker, Consent, Analytics | suggestion contract | opt-in/out, erasure, explanation |
| Enterprise | NFR-005/009, FR-002/043 | Tenant, Backoffice, Gateway, Platform | tenant scopes, webhooks | quota, SSO, bulk import, isolation |
| User experience | FR-080..093, NFR-011..016 | Web/PWA, API, Inventory, Shopping, Notification | job/status, preference, shopping, movement contracts | onboarding, batch scan, offline, accessibility, recovery |
| Delivery/data | NFR-003/005/009/010 | Platform, DB, CI/CD, Operations | config, migration, deployment, SLO | migration, restore, rollout, rollback |

## Definition of evidence

Una riga e completa solo quando esistono:

- test automatico o evidenza operativa ripetibile;
- dashboard/log/trace necessari alla diagnosi;
- decisione di sicurezza/privacy approvata;
- contratto versionato;
- owner e stato della verifica.

## Stato iniziale

La matrice e una baseline di progettazione. Nessuna voce e considerata implementata finche non viene aggiornata dal team con link a test, report o runbook reali. Il catalogo endpoint e le specifiche schermate sono riferimenti di pianificazione; OpenAPI e JSON Schema devono essere estesi fino a coprire ogni riga prima dell'API freeze.
