# Microservizi e ownership

| Service | Porta | DB dedicato | Ownership |
|---|---:|---|---|
| gateway | 3300 | nessuno | edge API/composition |
| service-identity | 3310 | identity_db | profilo/identity linkage |
| service-family | 3311 | family_db | famiglie/membri/inviti |
| service-inventory | 3312 | inventory_db | pantry corrente/lotti/movimenti |
| service-shopping | 3313 | shopping_db | liste/articoli spesa |
| service-catalog | 3314 | catalog_db | prodotti/barcode/provenance |
| service-notifications | 3315 | notifications_db | notifiche/preferenze |
| service-privacy | 3316 | privacy_db | consenso/export/erasure |
| service-jobs | 3317 | jobs_db | job lifecycle/retry/DLQ |
| service-recipes | 3401 | recipes_db | ricette/suggerimenti |
| service-nutrition | 3402 | nutrition_db | diario/target |
| service-stores | 3403 | stores_db | negozi/prezzi/offerte |
| service-shelf-life | 3404 | shelf_life_db | regole/predizioni scadenza |
| service-ocr | 3405 | ocr_db | job OCR/draft |
| off-lookup | 3200 | off_lookup_db | cache/read-through OpenFoodFacts |

Worker: core, OCR, shelf-life, OFF sync, notifications, integrations, scheduler e search-indexer. I worker elaborano job/eventi; non diventano owner del DB di un altro servizio.

Regole: niente import di domain code remoto, niente query cross-DB, niente foreign key cross-service, ID remoti validati tramite contratti.
