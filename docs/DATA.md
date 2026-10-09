# Dati e ownership

## PostgreSQL

Il Compose crea 13 database di servizio da `infrastructure/postgres/init/00-databases.sql`; il bootstrap dei ruoli aggiunge `food_semantics_db` e `keycloak_db`. Il cluster locale contiene quindi 15 database logici: 14 per i domini applicativi e uno per Keycloak. Ogni servizio applicativo usa il database del proprio dominio; la documentazione ER e l'elenco delle tabelle sono in [DIAGRAMS.md](DIAGRAMS.md#database-e-storage).

| Database | Owner applicativo | Concetti principali |
|---|---|---|
| `identity_db` | Identity | utenti, preferenze dietetiche, idempotenza e outbox |
| `family_db` | Family | famiglie, membri, inviti e tentativi di join |
| `inventory_db` | Inventory | articoli dispensa, lotti, movimenti, policy e consumer events |
| `shopping_db` | Shopping | liste, articoli, suggerimenti riordino, eventi processati |
| `catalog_db` | Catalog | prodotti, brand, identificatori, provenance, semantica materializzata |
| `notifications_db` | Notifications | notifiche, preferenze e deduplica eventi |
| `privacy_db` | Privacy | consensi, richieste export/erase, artefatti e audit |
| `jobs_db` | Jobs | job durevoli, tentativi, dead letters, inbox e audit |
| `recipes_db` | Recipes | ricette utente e catalogo globale/importato |
| `nutrition_db` | Nutrition | target, diario e deduplica eventi |
| `stores_db` | Stores | negozi, prezzi e offerte |
| `shelf_life_db` | Shelf-Life | regole, profili prodotto e predizioni |
| `ocr_db` | OCR | job, bozze, righe e idempotenza |
| `food_semantics_db` | Food Semantics | ontologia, label, relazioni, mapping e cache |
| `keycloak_db` | Keycloak | stato interno del provider OIDC, schema gestito da Keycloak |

La maggior parte dei riferimenti tra domini (per esempio `family_id`, `product_id`, `user_id`) è un UUID senza foreign key cross-database. Il servizio owner valida i riferimenti attraverso contratti interni. Le foreign key dentro uno stesso database sono mostrate nei diagrammi e definite nelle migration.

## Migrazioni

Le migration risiedono in `services/<service>/migrations`; i database iniziali in `infrastructure/postgres/init`. Food Semantics e Recipes hanno job Compose `*-schema-migrate` espliciti per ordinare la bootstrap/importazione. Per gli altri servizi, migration ed entrypoint vanno verificati nel codice del servizio. Non esiste un unico servizio Compose chiamato `db-migrate`.

## Altri datastore

- **MongoDB**: database `off_lookup_db`, collezione `products`; corpus/cache dei documenti Open Food Facts, non contiene la dispensa familiare.
- **OpenSearch**: indice derivato della ricerca OFF; è ricostruibile dai prodotti disponibili nella sorgente OFF.
- **Redis**: stream eventi `events:domain` e code/job di breve durata. Lo stato durevole dei job resta in PostgreSQL Jobs; gli eventi di dominio sono prima registrati negli outbox PostgreSQL.
- **MinIO**: oggetti binari per i flussi configurati, in particolare file OCR/ricevute. PostgreSQL conserva ownership e metadata.
- **Keycloak**: database dedicato `keycloak_db`, schema amministrato dal provider.
- **Translation models**: volume persistente LibreTranslate; non è un database di dominio.

## Integrità e concorrenza

Le mutazioni idempotenti e l'optimistic concurrency dipendono dal contratto del servizio. Dove presenti, usare `X-Idempotency-Key` e `If-Match`/versione; non generalizzarli ad API che non li dichiarano. Le modifiche stock registrano movimenti in Inventory. Una proiezione o indice secondario non diventa source of truth.
