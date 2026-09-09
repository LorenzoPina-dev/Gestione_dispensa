# Strategia test, benchmark e quality gates

## 1. Piramide

- unit: invarianti e policy pure;
- integration: PostgreSQL/Redis/object storage reali in container;
- contract: OpenAPI/event schema producer-consumer;
- component: servizio con dipendenze simulate;
- E2E: journey browser e QR;
- performance: API, DB, search, queue e provider;
- security: SAST, DAST, dependency, secret, container e authz;
- resilience: restart, timeout, DLQ, backup/restore e chaos controllato.

## 2. Dati di test

Solo fixture sintetiche o anonimizzate. Dataset minimo: famiglie multiple, utenti multi-family, ruoli, barcode noti/ignoti, prodotti duplicati, lotti/scadenze, unità incompatibili, offerte stale, provider failure, token QR nei quattro stati.

Il test di fondazione deve avviare il profilo Docker `family-local`, verificare health/readiness di ogni container, creare una famiglia, registrare una scorta, produrre una metrica e una trace visibile in Grafana/Prometheus/Tempo e completare un backup/restore di PostgreSQL e MinIO.

## 3. Acceptance per core

### Identity/family

- login success/fail/revoke;
- creator e membership atomica;
- QR valid/expired/revoked/used/tampered;
- replay idempotente;
- cross-family denial;
- role escalation denied;
- cache invalidation dopo rimozione.

### Inventory

- receipt/consumption/waste/adjustment/transfer;
- quantità e unità;
- concorrenza e ETag;
- duplicate command;
- ledger rebuild;
- reorder threshold boundary.

### Shopping

- dedupe suggerimenti;
- batch accept/reject;
- shared edit conflict;
- completed item e stock confirmation;
- offline pending/reconcile.

## 4. Contract test

Ogni endpoint OpenAPI ha almeno success, validation, unauthorized, forbidden, not-found, conflict, rate-limit e dependency-unavailable example. Ogni evento ha validator, unknown-field test, missing-required-field test, replay test e PII inspection.

## 5. Performance plan

Workload parametrico:

- famiglie attive;
- utenti/famiglia;
- richieste/sec per route;
- movimenti/giorno;
- jobs OCR/ricette/offerte per ora;
- dimensione catalogo;
- search query mix;
- retention e volume observability.

Misurare p50/p95/p99, error rate, CPU/RAM/IO, DB locks/queries, Redis lag, queue oldest age e cost/provider. Benchmarkare prima PostgreSQL search, poi OpenSearch solo se target non raggiunti.

## 6. Resilience scenarios

- API restart durante transaction;
- worker restart dopo side effect prima ack;
- Redis loss;
- PostgreSQL failover/restore;
- provider timeout/429/schema change;
- poison event e DLQ replay;
- outbox backlog;
- disco pieno/OOM;
- telemetry backend down;
- secret rotation;
- restore projection search.

Ogni scenario deve avere expected behavior, alert, recovery time e data-loss result.

## 7. Security gates

Nessun merge se falliscono critical/high senza eccezione firmata: dependency scan, secret scan, SAST, container scan, IaC/Kubernetes scan, DAST, authz matrix, SSRF/upload/CSRF/XSS/rate limit test.

## 8. Release evidence

Artifact per release: test report, coverage per domain rule, contract compatibility, SBOM, scan report, migration plan, performance delta, dashboard link, alert drill, backup age/restore evidence, known risks e approval owner.

## 9. Quality target

Coverage numerica non sostituisce casi di dominio. Le invarianti famiglia/invito/inventario, autorizzazione e recovery devono avere test diretti anche se la coverage globale e alta.
