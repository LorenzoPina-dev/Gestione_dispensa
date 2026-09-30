# Gestione Dispensa — Microservices v2

Questa directory è la **specifica canonica e normativa** della branch `architecture/microservices-v2`. L'implementazione deve essere derivata dai contratti qui descritti, non il contrario.

## Principi non negoziabili

1. Vera architettura a microservizi, non modular monolith.
2. Ogni microservizio è indipendente e deployabile/scalabile.
3. **Ogni microservizio possiede il proprio database dedicato.**
4. Nessun microservizio accede direttamente al DB di un altro.
5. Un PostgreSQL server/container locale può ospitare DB distinti; non è un DB condiviso.
6. API HTTP, eventi e job sono gli unici confini tra servizi.
7. Gateway non possiede dati di dominio.
8. Nginx è l'unico ingresso browser-facing.
9. MongoDB OpenFoodFacts è separato dal dominio pantry.
10. MinIO è object storage; Redis è infrastruttura transient/cache/queue.
11. Ogni mutation ha input, output, errori, idempotenza e concurrency policy documentati.
12. Ogni DB ha schema logico, migration, credenziali, backup e ownership propri.
13. Gli eventi hanno envelope e payload versionati.
14. Nessuna transazione distribuita.

## Ordine di lettura per implementazione

1. **CONTRACTS.md** — regole che rendono i contratti obbligatori e verificabili.
2. **SERVICES.md** — service owner, porte e DB.
3. **DATA.md** — schema logico dei DB e invarianti.
4. **API.md** — endpoint, input, output, status ed errori.
5. **openapi.yaml** — contratto HTTP machine-readable.
6. **EVENTS.md** — envelope, payload, outbox, retry e DLQ.
7. **FLOWS.md** — sequenze tra servizi.
8. **SECURITY.md** — auth, authorization e tenant isolation.
9. **NETWORK.md** — esposizione e rete.
10. **OPERATIONS.md** — startup, migration, backup e resilienza.
11. **TEST-STRATEGY.md** — test richiesti per dimostrare conformità.

## Documenti

- [CONTRACTS.md](./CONTRACTS.md) — governance e Definition of Done.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — architettura.
- [SERVICES.md](./SERVICES.md) — microservizi, porte e ownership.
- [DATA.md](./DATA.md) — database e schema logico.
- [API.md](./API.md) — contratto HTTP dettagliato.
- [openapi.yaml](./openapi.yaml) — contratto HTTP machine-readable.
- [EVENTS.md](./EVENTS.md) — contratto eventi.
- [FLOWS.md](./FLOWS.md) — flussi funzionali.
- [NETWORK.md](./NETWORK.md) — rete.
- [SECURITY.md](./SECURITY.md) — sicurezza.
- [OPERATIONS.md](./OPERATIONS.md) — operazioni.
- [REQUIREMENTS.md](./REQUIREMENTS.md) — requisiti.
- [REPOSITORY-STRUCTURE.md](./REPOSITORY-STRUCTURE.md) — struttura codice.
- [PRIVACY-PROFILING-AND-ANALYTICS.md](./PRIVACY-PROFILING-AND-ANALYTICS.md) — privacy/profilazione.
- [PROVIDER-MATRIX.md](./PROVIDER-MATRIX.md) — provider esterni.
- [RETENTION-AND-DATA-LIFECYCLE.md](./RETENTION-AND-DATA-LIFECYCLE.md) — lifecycle.
- [TEST-STRATEGY.md](./TEST-STRATEGY.md) — test.
- [THREAT-MODEL.md](./THREAT-MODEL.md) — threat model.

## Regola per l'implementazione

Una feature non può essere considerata implementata se manca uno dei suoi contratti. Prima si definiscono owner, DB/schema, endpoint/evento, input/output/errori e invarianti; poi si scrive il codice; infine i contract test dimostrano che il codice rispetta la specifica.
