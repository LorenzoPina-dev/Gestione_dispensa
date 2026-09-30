# Servizi

| Deployable | Porta | Responsabilità | Storage |
|---|---:|---|---|
| gateway | 3300 | API edge, auth, routing, Composite Views | — |
| service-identity | 3310 | profilo, registrazione, OIDC | PostgreSQL |
| service-family | 3311 | famiglie, membership, inviti | PostgreSQL |
| service-inventory | 3312 | stock, lotti, movimenti | PostgreSQL |
| service-shopping | 3313 | liste e articoli spesa | PostgreSQL |
| service-catalog | 3314 | prodotti, barcode, provenance | PostgreSQL |
| service-notifications | 3315 | notifiche | PostgreSQL |
| service-privacy | 3316 | consensi, export, erasure | PostgreSQL |
| service-jobs | 3317 | job | PostgreSQL + Redis |
| service-recipes | 3401 | ricette | PostgreSQL |
| service-nutrition | 3402 | diario/target nutrizionali | PostgreSQL |
| service-stores | 3403 | negozi, prezzi, offerte | PostgreSQL |
| service-shelf-life | 3404 | regole/predizioni scadenza | PostgreSQL |
| service-ocr | 3405 | OCR scontrini e draft | PostgreSQL + Redis |
| off-lookup | 3200 | cache OpenFoodFacts | MongoDB |
| web | — | SPA | — |

## Worker
- worker-core: job durevoli, inventory/restock, reconciliation/outbox
- worker-ocr: elaborazione OCR
- worker-shelf-life: predizioni/scadenze
- worker-off-sync: enrichment OpenFoodFacts
- worker-notifications: dispatch notifiche
- worker-integrations: provider esterni
- scheduler: task periodici
- search-indexer: proiezioni ricostruibili

## Dipendenze
```text
Catalog → OFF Lookup
Inventory → Shelf-Life
Shopping → Inventory
Recipes → Inventory + Shopping
Nutrition → ricette/consumi
OCR → Inventory + Stores alla conferma
```
Le dipendenze non autorizzano accesso diretto alle tabelle di un altro dominio.

Shared packages: contracts, config, domain, observability, testkit e ui. Solo riuso tecnico/wire-level.