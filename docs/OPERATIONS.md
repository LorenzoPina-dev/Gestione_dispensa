# Operations

## Service lifecycle
Ogni service è buildato, migrato, avviato, monitorato e scalato indipendentemente. I worker consumano job/eventi e non diventano owner dei DB di dominio.

## Startup
1. network/datastore;
2. Keycloak;
3. microservizi;
4. worker/scheduler;
5. Nginx/Web.

Liveness indica che il processo è vivo; readiness indica che il service può ricevere traffico.

## Database migrations
Ogni service esegue migration esclusivamente sul proprio DB. Nessuna migration globale modifica database appartenenti ad altri bounded context.

## Resilience
Timeout, retry solo per operazioni retry-safe, circuit breaker/bulkhead quando appropriato, Outbox, idempotenza consumer, DLQ e job state durevole.

## Observability
Propagare requestId/correlationId/traceId su HTTP ed eventi. I log non devono contenere password, token o credenziali.

## Backup
Backup, restore e retention sono per-service. Il restore di inventory_db non richiede il restore di family_db.

## Testing
Ogni service deve avere unit test, integration test sul proprio DB e contract test HTTP/eventi. I test end-to-end verificano i flussi attraverso Gateway senza introdurre accesso cross-DB.

## Failure isolation
Un service non disponibile deve produrre timeout/partial failure espliciti nelle Composite Views, senza trasformare il Gateway in un nuovo source of truth.

## Operazioni OFF search

### Bootstrap iniziale

`search-indexer` verifica la disponibilità OpenSearch, crea l'indice se assente e avvia automaticamente
un bootstrap paginato dalla source interna di `off-lookup`.

Il bootstrap:
- usa batch piccoli e un ritardo configurabile per evitare picchi di CPU/I/O;
- persiste un cursor solo dopo un bulk riuscito;
- può essere interrotto e ripreso senza ricominciare dal primo prodotto;
- termina con stato `complete` e non riparte ai successivi avvii;
- continua in background mentre il servizio è già ready.

### Retry

Il bootstrap viene ritentato periodicamente se OpenSearch o il source service sono temporaneamente
indisponibili. Il job è serializzato e non può essere eseguito in parallelo con sé stesso.

### Migrazione Mongo

All'avvio, il one-shot `off-mongodb-index-maintenance` elimina l'eventuale indice Mongo storico
`keywords_1`/`_keywords` e mantiene solo l'indice `code_1` necessario al lookup barcode e alla
pagination del bootstrap. L'operazione non elimina il volume Mongo né i documenti.

### Reindex completo

Il reindex è esplicito tramite endpoint interno e deve essere usato dopo:
- modifica breaking del mapping;
- corruzione dell'indice;
- modifica della funzione di projection;
- migrazione del dump OFF.

La ricostruzione è paginata e non usa una transazione distribuita.

### Monitoring minimo

Devono essere osservabili almeno:
- disponibilità OpenSearch;
- document count;
- stato bootstrap/rebuild;
- numero di errori source HTTP;
- tempo medio/p95 della ricerca locale;
- p95 del fallback esterno;
- numero di upsert projection falliti;
- projection lag quando il meccanismo di eventi/reconciliation sarà attivo.

### Sizing

L'heap OpenSearch nel Compose è un default locale e non uno SLO. La dimensione definitiva deve essere determinata con il corpus reale. Dataset OFF grandi non devono essere caricati integralmente in RAM da Node: il trasferimento source è paginato e la projection è slim.
