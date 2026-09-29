# Operations and resilience

## Health

Ogni HTTP service espone:

```text
/health/live
/health/ready
```

`live` indica che il processo è vivo; `ready` verifica le dipendenze indispensabili.

## Failure handling

- HTTP timeout al Gateway;
- retry solo per operazioni dichiarate retryable;
- `X-Idempotency-Key` per mutazioni duplicate-safe;
- ETag/`If-Match` per conflitti di versione;
- queue retry bounded;
- DLQ metadata persistente;
- graceful shutdown dei worker.

## Database recovery

Backup PostgreSQL e MinIO devono essere eseguiti separatamente e verificati con restore drill. Le migration sono applicate da un runner esterno con advisory lock e checksum.

## Observability

Metriche minime:

- request latency/error rate;
- queue depth/oldest job;
- retry/DLQ;
- DB latency/connection pool;
- cache hit/miss;
- CPU/RAM/disk;
- backup age;
- notification delivery;
- OCR confidence e review rate.

## Degraded mode

La perdita di una cache/catalog provider non deve rendere inutilizzabile la dispensa. La perdita di un provider push non deve impedire la creazione di notifiche in-app. La perdita di un servizio necessario a una mutation deve produrre un errore esplicito e retry-safe.
