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

## Test matrix: OFF search

### Unit

```text
normalizzazione query
projection OFF -> OpenSearch
mapping nutriments
ranking exact > prefix > weak lexical
gestione campi mancanti
barcode validation
cache hit della query
local hit -> nessun fallback esterno
local miss -> fallback esterno
local unavailable -> fallback esterno
upsert index async non blocca barcode hit
```

### Integration

Il profilo Docker deve verificare almeno:
1. OpenSearch healthy.
2. search-indexer healthy.
3. inserimento di un documento synthetic tramite endpoint interno.
4. ricerca synthetic via search-indexer.
5. off-lookup restituisce `source=local` per il synthetic.
6. una query senza hit locale usa il confine Search-a-licious (test di unit/component con provider simulato; nessuna dipendenza dal servizio pubblico nel test deterministico).
7. reindex ricostruisce il documento a partire dalla source Mongo nel test con fixture.

### E2E manual product

Journey obbligatoria:

```text
"Golia"
 -> lista risultati
 -> selezione di un code
 -> CandidateView completo
 -> quantità
 -> scadenza vuota
 -> luogo
 -> Inventory item
 -> Shelf-Life queued
 -> eventuale expiration_source=estimated
```

Il test deve inoltre verificare che digitando rapidamente query successive le richieste precedenti vengano abortite lato browser e che un risultato vecchio non sovrascriva una query più recente.

### Regression

La ricerca per barcode deve continuare a funzionare quando:
- OpenSearch è spento;
- search-indexer è spento;
- Mongo è presente;
- Mongo è vuoto ma OFF API simulata è disponibile;
- Catalog contiene già il prodotto;
- Catalog non contiene il prodotto.
