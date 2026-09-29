# Gestione Dispensa

Monorepo professionale per una piattaforma family-first di gestione della dispensa, spesa, ricette, nutrizione, scadenze, barcode e scontrini.

## Architettura corrente

La piattaforma è composta esclusivamente da deployable indipendenti. Non esiste un'applicazione API monolitica: ogni bounded context possiede il proprio processo, le proprie route e la propria ownership applicativa.

```text
Browser
  │ HTTPS :8443
  ▼
Nginx
  ├── /              → services/web
  ├── /api/v1/*      → services/gateway
  └── /realms/*      → Keycloak

services/gateway
  │
  ├── service-identity       :3310
  ├── service-family         :3311
  ├── service-inventory      :3312
  ├── service-shopping       :3313
  ├── service-catalog        :3314
  ├── service-notifications  :3315
  ├── service-privacy        :3316
  ├── service-jobs           :3317
  ├── service-recipes        :3401
  ├── service-nutrition      :3402
  ├── service-stores         :3403
  ├── service-shelf-life     :3404
  └── service-ocr            :3405

Async
  ├── worker-core
  ├── worker-ocr
  ├── worker-shelf-life
  ├── worker-off-sync
  ├── worker-notifications
  ├── worker-integrations
  └── scheduler

Data
  ├── PostgreSQL: transactional domain schemas
  ├── MongoDB: OpenFoodFacts cache
  └── MinIO: images and attachments
```

## Regola di rete

```text
Browser → Nginx → Gateway → owning service
```

I servizi applicativi non devono essere raggiunti direttamente dal browser. Le porte interne sono accessibili esclusivamente sulla rete Docker/cluster prevista dal deployment.

## Composite Views

La UI usa una richiesta per schermata. Il Gateway compone server-side i dati dei servizi proprietari:

```text
GET /api/v1/views/dashboard-today
GET /api/v1/views/pantry-screen
GET /api/v1/views/shopping-screen
GET /api/v1/views/recipes-screen
GET /api/v1/views/nutrition-screen
GET /api/v1/views/family-screen
GET /api/v1/views/notifications-screen
```

Il browser mantiene la cache TanStack Query e può prefetchare una view. Le mutazioni usano invece l'endpoint del dominio proprietario attraverso il Gateway.

## Repository

```text
services/
  gateway/                 # routing, auth verification, BFF/composite views
  web/                     # React/Vite SPA, deployable UI
  service-identity/        # identità e profilo
  service-family/          # famiglie, membership, inviti
  service-inventory/       # posizioni, stock, lotti, movimenti
  service-shopping/       # liste e articoli
  service-catalog/         # prodotti e barcode
  service-notifications/  # notifiche e stato di lettura
  service-privacy/         # export, erasure, consensi
  service-jobs/            # stato e amministrazione job
  service-recipes/         # ricette e suggerimenti
  service-nutrition/       # diario e target nutrizionali
  service-stores/          # negozi e prezzi
  service-shelf-life/      # regole e predizioni shelf-life
  service-ocr/             # scontrini, job OCR e draft di revisione
  off-lookup/              # cache OpenFoodFacts
  worker-*/                # pipeline asincrone
  scheduler/               # pianificazione periodica
  search-indexer/          # proiezioni di ricerca ricostruibili

packages/
  contracts/               # contratti wire condivisi
  config/                  # configurazione tipizzata
  domain/                  # primitive realmente condivise
  observability/           # logging, tracing, metriche
  testkit/                 # fixture e harness di test
  ui/                      # primitive UI accessibili

infra/
  nginx/
  compose/
  postgres/
  identity/
  storage/
  observability/
  kubernetes/

docs/
  architecture/
  contracts/
  data/
  operations/
  security/
```

## Storage ownership

| Storage/schema | Owner | Contenuto |
|---|---|---|
| `public` | Identity/Family/Inventory/Shopping/Catalog/Notifications/Privacy/Jobs | dati transazionali core condivisi per chiavi e relazioni |
| `recipes_domain` | Recipes | ricette e ingredienti |
| `nutrition_domain` | Nutrition | diario, target e aggregazioni nutrizionali |
| `stores_domain` | Stores | negozi, prezzi e storico |
| `shelf_life_domain` | Shelf-Life | regole e predizioni |
| `ocr_domain` | OCR | job, righe estratte e draft di revisione |
| MongoDB | OFF Lookup | cache/read-through OpenFoodFacts |
| MinIO | Storage boundary | immagini, scontrini e allegati |

La source of truth transazionale rimane PostgreSQL. MongoDB non contiene giacenze familiari.

## Avvio locale — zero setup manuale

Il percorso locale è progettato per essere avviato direttamente con Docker. Non è necessario eseguire manualmente `npm install`, creare lo schema PostgreSQL o applicare le migrazioni.

```bash
docker compose up --build -d
```

Al primo avvio Compose:
1. avvia PostgreSQL e Redis;
2. avvia Keycloak e importa automaticamente il realm `dispensa`;
3. avvia il container one-shot `db-migrate`, che applica tutte le migrazioni pendenti in ordine;
4. prepara automaticamente un certificato HTTPS locale se non esiste già;
5. avvia i servizi solo dopo che database, migrazioni e dipendenze richieste sono pronti;
6. espone la SPA e tutte le API esclusivamente tramite Nginx.

Le migrazioni sono idempotenti e il runner usa un advisory lock PostgreSQL, quindi un riavvio non riesegue le migrazioni già applicate.

Ingresso ufficiale:

```text
https://<host-lan>:8443/
```

Il default del repository è `https://192.168.1.24:8443/`. Per un altro indirizzo LAN è sufficiente impostare `LAN_HOST` e le eventuali variabili OIDC nel proprio ambiente prima di avviare Compose.

## Quality gates

```bash
npm run validate:structure
npm run typecheck
npm run build
npm test
```

I test end-to-end richiedono PostgreSQL, Redis e Keycloak disponibili.

## Documentazione canonica

- `docs/ARCHITECTURE.md` — architettura runtime e confini
- `docs/SERVICE-CATALOG.md` — catalogo dei servizi e ownership
- `docs/API-ENDPOINT-CATALOG.md` — API canoniche
- `docs/COMPOSITE-VIEWS.md` — BFF e contratti delle schermate
- `docs/DATABASE-ARCHITECTURE.md` — storage e ownership dati
- `docs/DATA-FLOWS-UI-CONTRACTS.md` — flussi applicativi
- `docs/EVENT-SCHEMAS.md` — eventi e code
- `docs/CURRENT-IMPLEMENTATION-STATUS.md` — stato reale dell'implementazione
- `docs/REPOSITORY-STRUCTURE.md` — struttura della codebase
