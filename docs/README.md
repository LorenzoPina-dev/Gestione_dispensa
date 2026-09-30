# Gestione Dispensa — Microservices v2

Questa documentazione è specifica per `architecture/microservices-v2`.

## Regole architetturali
- Microservizi realmente indipendenti e deployabili.
- **Ogni microservizio possiede il proprio database dedicato.**
- Nessun servizio accede direttamente al database di un altro.
- Un unico container PostgreSQL in sviluppo può ospitare database distinti, ma NON costituisce un database condiviso: ogni servizio usa database, credenziali e migration propri.
- Comunicazione inter-service tramite HTTP o eventi.
- Gateway senza business ownership e senza database di dominio.
- Nginx è l'unico ingresso browser-facing.
- MongoDB OpenFoodFacts è separato e appartiene a OFF Lookup.
- MinIO contiene blob; Redis è infrastruttura transient/cache/queue.

## Documenti canonici
ARCHITECTURE.md · SERVICES.md · DATA.md · EVENTS.md · FLOWS.md · API.md · NETWORK.md · SECURITY.md · OPERATIONS.md · REQUIREMENTS.md · REPOSITORY-STRUCTURE.md · openapi.yaml
