# Data architecture

## Database-per-service (obbligatorio)

Ogni microservizio applicativo possiede un database dedicato, con:

- ownership esclusiva del servizio;
- credenziali dedicate;
- migration dedicate;
- backup/restore indipendenti;
- nessun accesso SQL da parte di altri servizi;
- nessuna FK, JOIN o transazione distribuita cross-service.

In sviluppo Docker è ammesso un singolo **server/container PostgreSQL** che ospita più database fisicamente/logicamente distinti:

```
postgres-server
├── identity_db
├── family_db
├── inventory_db
├── shopping_db
├── catalog_db
├── notifications_db
├── privacy_db
├── jobs_db
├── recipes_db
├── nutrition_db
├── stores_db
├── shelf_life_db
└── ocr_db
```

Questo è database-per-service, non schema-per-service. In produzione ogni DB può essere spostato su un'istanza PostgreSQL separata senza cambiare i contratti applicativi.

## Ownership

| DB | Owner | Contenuto |
|---|---|---|
| identity_db | Identity | profilo e linkage OIDC |
| family_db | Family | famiglie, membri, inviti |
| inventory_db | Inventory | stato corrente, lotti, movimenti |
| shopping_db | Shopping | liste e articoli |
| catalog_db | Catalog | prodotti canonici, barcode, provenance |
| notifications_db | Notifications | notifiche/preferenze |
| privacy_db | Privacy | consensi, export, erasure |
| jobs_db | Jobs | lifecycle job, retry, DLQ metadata |
| recipes_db | Recipes | ricette e suggerimenti |
| nutrition_db | Nutrition | diario e target |
| stores_db | Stores | negozi, prezzi, offerte |
| shelf_life_db | Shelf-Life | regole e predizioni |
| ocr_db | OCR | job OCR, draft e confidence |
| off_lookup_db | OFF Lookup | cache/read-through OpenFoodFacts |

## Inventory

Inventory conserva solo la vista corrente della dispensa e il ledger storico necessario. Se una quantità arriva a zero o un prodotto viene scartato, l'elemento viene rimosso dallo stato corrente; la movimentazione può rimanere nello storico.

## Catalog e OpenFoodFacts

Catalog è il proprietario del prodotto canonico. OFF Lookup è un servizio separato con MongoDB dedicato al dump/cache OpenFoodFacts. Il catalogo OFF non è la dispensa dell'utente.

Flusso barcode:

`scan -> Catalog -> OFF Lookup -> MongoDB cache -> remote OFF fallback -> cache -> Catalog -> user confirmation -> Inventory`

## Blob e infrastruttura

MinIO contiene immagini prodotto, ricevute e allegati. Il servizio owner conserva nel proprio DB metadata, ownership, checksum e object key.

Redis può fornire cache, lock e trasporto transient dei job/eventi. Non è source of truth per dati che devono sopravvivere a restart.

## Cross-service data

Per leggere dati di un altro dominio si usa:

1. API del service owner;
2. evento + projection locale;
3. Composite View nel Gateway.

Mai accesso diretto al DB remoto.
