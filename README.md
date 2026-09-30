# Gestione Dispensa

Piattaforma family-first per dispensa, spesa, ricette, nutrizione, scadenze, barcode e scontrini.

## Architettura

Browser → Nginx :8443 → Gateway :3300 → microservizio owner.

Il Gateway è l'unico edge API; i servizi interni comunicano sulla rete Docker. PostgreSQL è la source of truth transazionale, MongoDB è la cache OpenFoodFacts e MinIO contiene immagini/allegati. I lavori lunghi passano da Redis/job/worker.

## Deployable principali

- gateway
- web
- service-identity
- service-family
- service-inventory
- service-shopping
- service-catalog
- service-notifications
- service-privacy
- service-jobs
- service-recipes
- service-nutrition
- service-stores
- service-shelf-life
- service-ocr
- off-lookup
- worker-* / scheduler / search-indexer

## Avvio locale

```bash
docker compose up --build -d
```

Ingresso: `https://<LAN_HOST>:8443/`.

Compose prepara dipendenze, Keycloak, migration e servizi secondo le healthcheck.

## Documentazione canonica

La documentazione tecnica è stata ridotta a pochi documenti complementari:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — topologia e regole microservizi
- [docs/SERVICES.md](docs/SERVICES.md) — servizi, porte, ownership e dipendenze
- [docs/DATA.md](docs/DATA.md) — datastore e ownership dati
- [docs/FLOWS.md](docs/FLOWS.md) — flussi applicativi
- [docs/API.md](docs/API.md) — API, Gateway e Composite Views
- [docs/SECURITY.md](docs/SECURITY.md) — auth, authorization e tenant isolation
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — avvio, health e diagnosi
- [docs/openapi.yaml](docs/openapi.yaml) — contratto API machine-readable

Per la documentazione completa partire da `docs/README.md`.
