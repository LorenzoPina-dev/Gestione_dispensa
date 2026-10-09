# Servizi e processi

Le porte sono interne alla rete Compose, salvo NGINX `:8443`. La colonna “database” indica ownership logica, non un cluster separato.

## API e servizi runtime

| Compose service | Porta interna | Responsabilità | Database / storage |
|---|---:|---|---|
| `web` | HTTP container | SPA | — |
| `gateway` | 3300 | JWT, routing API, composizione richieste | — |
| `service-identity` | 3310 | profilo e preferenze dietetiche | `identity_db` |
| `service-family` | 3311 | famiglie, membership, inviti | `family_db` |
| `service-inventory` | 3312 | dispensa, lotti, movimenti e policy riordino | `inventory_db` |
| `service-shopping` | 3313 | liste, articoli, suggerimenti riordino | `shopping_db` |
| `service-catalog` | 3314 | prodotti applicativi, barcode e provenance | `catalog_db` |
| `service-notifications` | 3315 | notifiche, preferenze e deduplica | `notifications_db` |
| `service-privacy` | 3316 | consensi, richieste export/erase e audit | `privacy_db` |
| `service-jobs` | 3317 | stato job, tentativi, dead letter e replay amministrativo | `jobs_db` + Redis |
| `service-recipes` | 3401 | catalogo ricette, ricerca, suggerimenti, mancanti | `recipes_db` |
| `service-nutrition` | 3402 | target, diario e riepilogo nutrizionale | `nutrition_db` |
| `service-stores` | 3403 | negozi, prezzi e offerte | `stores_db` |
| `service-shelf-life` | 3404 | profili, regole e predizioni di scadenza | `shelf_life_db` |
| `service-ocr` | 3405 | job OCR, draft e righe da revisionare | `ocr_db`, Redis, MinIO opzionale |
| `service-food-semantics` | 3410 | identità alimentari, ontologia, label e mapping | `food_semantics_db` |
| `off-lookup` | 3200 | lookup/cache e fallback Open Food Facts | MongoDB `off_lookup_db` |
| `search-indexer` | 3210 | indice prodotti OFF e sincronizzazione/bootstrap | OpenSearch |

## Worker e relay attivi in Compose

| Processo | Compito |
|---|---|
| `relay-identity/family/inventory/shopping/catalog/notifications/privacy/recipes/nutrition/stores/shelf-life/ocr` | relay per-dominio: legge l'outbox del relativo database e pubblica su Redis Stream `events:domain` |
| `worker-ocr` | consuma la coda OCR e chiede a service-ocr di elaborare il job |
| `worker-shelf-life` | consuma eventi e job di stima scadenza; usa Catalog per il contesto prodotto |
| `worker-shopping` | consuma eventi Inventory e aggiorna suggerimenti di riordino |
| `worker-notifications` | consuma eventi e applica preferenze/deduplica prima della consegna configurata |

Il codice contiene anche package/runtime per worker-core, worker-integrations e scheduler: la loro presenza nel repository non implica che siano servizi Compose attivi. Verificare `docker-compose.yml` prima di considerarli parte del deployment locale.

## Processi one-shot e ausiliari

- `postgres-app-role-init`: prepara ruoli applicativi e database aggiuntivi.
- `service-food-semantics-schema-migrate` e `service-recipes-schema-migrate`: applicano le migration prima dei rispettivi servizi.
- `service-food-semantics-bootstrap`: importa la sorgente ontologica configurata.
- `recipes-catalog-import`: import esplicito del dataset globale ricette.
- `minio-ready`: controlla/pronta il servizio oggetti; la sua indisponibilità non deve bloccare tutto il sistema.
- `off-mongodb-index-maintenance`: manutenzione degli indici Mongo OFF.
- `off-image-integration-test`: container di verifica con profilo `integration`, non parte del normale runtime.

## Infrastruttura

PostgreSQL, Redis, MongoDB, MinIO, OpenSearch e Keycloak supportano il runtime. LibreTranslate è il backend traduzione. Prometheus/Grafana, Loki, Tempo, Alloy, OTel Collector, cAdvisor e Postgres Exporter forniscono osservabilità. Nessuno di questi componenti assegna ownership di dominio al Gateway.
