# System blueprint

## Runtime

Il deployment standard è una rete di container indipendenti dietro Nginx. Il profilo `family-local` è ottimizzato per un singolo host ma mantiene gli stessi confini applicativi del deployment distribuito.

```text
Nginx → Web/Gateway → services → PostgreSQL/Redis/MongoDB/MinIO
```

## Design principles

- domain ownership esplicita;
- stateless HTTP services quando possibile;
- state durevole in PostgreSQL;
- queue per lavori lunghi;
- idempotency per retry;
- ETag per optimistic concurrency;
- RLS per database isolation;
- Composite Views per efficienza UI;
- osservabilità cross-service.

## Scaling

I servizi stateless possono essere replicati indipendentemente. PostgreSQL, Redis, MongoDB e MinIO richiedono policy specifiche di capacity, backup e recovery.
