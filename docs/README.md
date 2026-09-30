# Gestione Dispensa — Microservices v2

Questa directory è la documentazione canonica della branch `architecture/microservices-v2`.

## Principi non negoziabili

1. È una vera architettura a microservizi, non un modular monolith.
2. Ogni microservizio è indipendente e deployabile/scalabile.
3. **Ogni microservizio possiede il proprio database dedicato.**
4. Nessun microservizio accede direttamente al database di un altro.
5. In sviluppo è possibile usare un solo server/container PostgreSQL per ospitare database distinti. Questo non significa avere un database condiviso.
6. Le integrazioni avvengono tramite API HTTP interne, eventi e job.
7. Il Gateway non possiede dati di dominio.
8. Nginx è l'unico ingresso browser-facing.
9. MongoDB OpenFoodFacts è separato dal dominio pantry.
10. MinIO è object storage; Redis è infrastruttura transient/cache/queue.

## Documentazione

- [ARCHITECTURE.md](./ARCHITECTURE.md) — struttura e principi.
- [SERVICES.md](./SERVICES.md) — microservizi, porte e ownership.
- [DATA.md](./DATA.md) — database-per-service e data ownership.
- [EVENTS.md](./EVENTS.md) — eventi, Outbox, retry e DLQ.
- [FLOWS.md](./FLOWS.md) — flussi funzionali.
- [API.md](./API.md) — Gateway e contratti HTTP.
- [NETWORK.md](./NETWORK.md) — rete e esposizione.
- [SECURITY.md](./SECURITY.md) — identity, authorization e isolamento.
- [OPERATIONS.md](./OPERATIONS.md) — migration, resilienza, backup e testing.
- [REQUIREMENTS.md](./REQUIREMENTS.md) — requisiti architetturali/funzionali.
- [REPOSITORY-STRUCTURE.md](./REPOSITORY-STRUCTURE.md) — struttura del codice.
- [PRIVACY-PROFILING-AND-ANALYTICS.md](./PRIVACY-PROFILING-AND-ANALYTICS.md) — vincoli privacy/profilazione ancora specifici.
- [PROVIDER-MATRIX.md](./PROVIDER-MATRIX.md) — provider esterni ancora necessari.
- [RETENTION-AND-DATA-LIFECYCLE.md](./RETENTION-AND-DATA-LIFECYCLE.md) — retention specifica.
- [TEST-STRATEGY.md](./TEST-STRATEGY.md) — strategia di test dettagliata.
- [THREAT-MODEL.md](./THREAT-MODEL.md) — minacce e controlli dettagliati.
- [openapi.yaml](./openapi.yaml) — contratto HTTP machine-readable.

I documenti specialistici rimasti non definiscono ownership alternativa: integrano i documenti canonici.
