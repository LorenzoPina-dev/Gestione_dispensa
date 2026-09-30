# Operations

## Deployment

Ogni service è buildato, migrato, avviato, monitorato e scalato indipendentemente. I worker sono consumer/elaboratori e non possiedono i DB dei service.

## Startup

Ordine logico:

1. network e datastore;
2. Keycloak;
3. microservizi;
4. worker/scheduler;
5. Nginx/Web.

Ogni servizio deve tollerare dipendenze temporaneamente non pronte e distinguere liveness da readiness.

## Migration

Ogni servizio esegue migration **solo sul proprio database**. Non esiste una migration globale che modifica più bounded context.

## Resilience

- timeout inter-service;
- retry solo per operazioni retry-safe/idempotenti;
- circuit breaker/bulkhead dove necessario;
- Outbox;
- consumer idempotenti;
- DLQ;
- job state durevole in jobs_db.

## Observability

Log strutturati, metriche e distributed tracing propagano requestId/correlationId/traceId attraverso HTTP ed eventi.

## Backup

Backup e restore sono per-service. Il restore di `inventory_db` non richiede il restore di `family_db`.

## Failure isolation

La perdita di un service non deve rendere indisponibili tutti gli altri. Il Gateway espone timeout/partial failure in modo esplicito per le Composite Views.
