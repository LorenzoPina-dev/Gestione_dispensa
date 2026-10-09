# Documentazione tecnica

Questa documentazione descrive il repository `Gestione_dispensa` e i servizi presenti nel branch `main`. Per runtime e deploy, `docker-compose.yml` è la fonte dell'elenco dei container; per schema e vincoli fanno fede le migration SQL; per le API fanno fede route handler e [OpenAPI](openapi.yaml).

## Da dove iniziare

1. [ARCHITECTURE.md](ARCHITECTURE.md) — confini, reti e componenti runtime.
2. [DIAGRAMS.md](DIAGRAMS.md) — architettura, database e flussi funzionali Mermaid.
3. [SERVICES.md](SERVICES.md) — deployable Compose, porte, ownership e processi di supporto.
4. [DATA.md](DATA.md) — database, storage, migrazioni e regole di ownership.
5. [FLOWS.md](FLOWS.md) — percorsi sincroni e asincroni principali.
6. [API.md](API.md) e [openapi.yaml](openapi.yaml) — contratti HTTP.
7. [EVENTS.md](EVENTS.md) — envelope degli eventi, outbox, stream e consumer.
8. [SECURITY.md](SECURITY.md) e [NETWORK.md](NETWORK.md) — identità, autorizzazione e reti.
9. [OPERATIONS.md](OPERATIONS.md) — avvio, health check e diagnosi.
10. [TESTING.md](TESTING.md) — livelli e comandi di verifica.

## Mappa della repository

- `apps/web`: SPA browser.
- `services/`: gateway, servizi di dominio, lookup esterno e worker.
- `packages/`: librerie condivise (runtime DB/auth, contratti, regole e osservabilità).
- `infrastructure/`: configurazione locale di PostgreSQL, NGINX, Keycloak, Redis, ricerca e telemetria.
- `scripts/`: build, audit strutturali e controlli repository.
- `e2e/`: scenari end-to-end.
- `docs/`: documentazione, contratti API e diagrammi.

I diagrammi descrivono capacità e flussi di prodotto; non enumerano ogni metodo interno TypeScript. Le funzioni non implementate o non collegate a un consumer sono indicate come tali. Ogni documento che diverge dal codice o da Compose va corretto nello stesso cambiamento che introduce la divergenza.
