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
