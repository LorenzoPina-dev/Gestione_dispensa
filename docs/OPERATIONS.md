# Operations

Ogni servizio avvia le proprie migration sul proprio DB. Non esiste una migration globale che modifichi database di altri servizi.

Startup logico: datastore/network -> Keycloak -> services -> workers/scheduler -> Nginx/Web. Readiness deve distinguere dipendenze non pronte da processo morto.

Resilienza: timeout, retry solo su operazioni sicure/idempotenti, circuit breaker/bulkhead quando necessario, outbox, consumer idempotenti, DLQ e job state durevole.

Observability: log strutturati, metriche e tracing con propagazione requestId/correlationId/traceId su HTTP ed eventi.

Backup e restore sono per-service: il ripristino di inventory_db non richiede il restore di family_db o shopping_db.
