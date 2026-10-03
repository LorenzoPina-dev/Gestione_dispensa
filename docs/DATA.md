# Data Contract — Database per Service

Questo documento è normativo per persistenza, ownership e schema logico. I nomi possono essere implementati con ORM diversi, ma semantica, cardinalità, vincoli e proprietà devono rimanere equivalenti.

## 1. Regola fondamentale

**Un microservizio = un database dedicato.**

Un PostgreSQL server locale può contenere più database, ma ogni database ha owner, utente/password, migration, backup/restore, connection string e tabelle propri. Nessuna FK, JOIN o transazione attraversa due database.

Gli ID di altri servizi sono semplici UUID/stringhe remote, mai foreign key.

Tutti i database PostgreSQL applicativi usano UTC e `timestamptz`. Le tabelle principali hanno PK e, quando indicato, `version` per optimistic concurrency.

## 2. Database

| DB | Owner | Tecnologia | Tabelle authoritative |
|---|---|---|---|
| identity_db | Identity | PostgreSQL | users, outbox_events, idempotency_keys |
| family_db | Family | PostgreSQL | families, members, invites, outbox_events, idempotency_keys |
| inventory_db | Inventory | PostgreSQL | pantry_items, pantry_lots, movements, outbox_events, idempotency_keys |
| shopping_db | Shopping | PostgreSQL | shopping_domain.lists, shopping_domain.items, shopping_domain.outbox_events, shopping_domain.idempotency_keys |
| catalog_db | Catalog | PostgreSQL | products, product_identifiers, data_sources, data_provenance, outbox_events, idempotency_keys |
| notifications_db | Notifications | PostgreSQL | notifications_domain.notifications, notifications_domain.preferences, notifications_domain.outbox_events, notifications_domain.idempotency_keys |
| privacy_db | Privacy | PostgreSQL | privacy_consents, privacy_erasure_requests, privacy_export_jobs, export_artifacts, audit_events, outbox_events, idempotency_keys |
| jobs_db | Jobs | PostgreSQL | jobs, job_attempts, dead_letter_jobs, audit_events, inbox_events |
| recipes_db | Recipes | PostgreSQL | recipes_domain.recipes, recipes_domain.recipe_ingredients, recipes_domain.recipe_steps, recipes_domain.outbox_events, recipes_domain.idempotency_keys |
| nutrition_db | Nutrition | PostgreSQL | nutrition_domain.targets, nutrition_domain.diary_entries, nutrition_domain.outbox_events, nutrition_domain.idempotency_keys |
| stores_db | Stores | PostgreSQL | stores_domain.stores, stores_domain.prices, stores_domain.offers, stores_domain.outbox_events, stores_domain.idempotency_keys |
| shelf_life_db | Shelf-Life | PostgreSQL | shelf_life_domain.rules, shelf_life_domain.predictions, shelf_life_domain.outbox_events, shelf_life_domain.idempotency_keys |
| ocr_db | OCR | PostgreSQL | ocr_domain.ocr_jobs, ocr_domain.ocr_drafts, ocr_domain.ocr_draft_items, ocr_domain.outbox_events, ocr_domain.idempotency_keys |
| off_lookup_db | OFF Lookup | MongoDB | products cache/read-through, sync metadata |

## 3. Convenzioni comuni

### Entity

```text
id UUID PK
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL DEFAULT 1
```

I timestamp sono generati dal server.

### schema_migrations — bookkeeping tecnico

Ogni database applicativo possiede la propria `schema_migrations(version, applied_at)` nel proprio schema pubblico. È usata esclusivamente dal migration runner e non è una tabella di dominio.

### Outbox

```text
outbox_events
- id UUID PK
- event_id UUID UNIQUE NOT NULL
- event_type varchar NOT NULL
- schema_version integer NOT NULL
- aggregate_id UUID NOT NULL
- family_id UUID NULL
- correlation_id UUID NOT NULL
- causation_id UUID NULL
- occurred_at timestamptz NOT NULL
- payload JSONB NOT NULL
- published_at timestamptz NULL
- attempts integer NOT NULL DEFAULT 0
- last_error text NULL
- created_at timestamptz NOT NULL
```

Indice minimo: `(published_at, created_at)`. Mutation e outbox insert sono una sola transazione.

### Idempotency

```text
idempotency_keys
- key varchar(255) PK
- actor_user_id UUID NOT NULL
- family_id UUID NULL
- request_hash varchar(64) NOT NULL
- status varchar NOT NULL -- processing|completed|failed
- response_status integer NULL
- response_body JSONB NULL
- created_at timestamptz NOT NULL
- expires_at timestamptz NOT NULL
```

Stessa chiave con request hash differente = 409.

## 4. identity_db

### users

```text
id UUID PK
subject varchar UNIQUE NOT NULL
email varchar NULL
display_name varchar NULL
avatar_url varchar NULL
locale varchar(16) NOT NULL DEFAULT 'it-IT'
timezone varchar(64) NOT NULL DEFAULT 'Europe/Rome'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

`subject` è l'identificatore OIDC. Identity non possiede password/credential OIDC.

## 5. family_db

### families

```text
id UUID PK
name varchar(120) NOT NULL
created_by_user_id UUID NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### members

```text
id UUID PK
family_id UUID NOT NULL
user_id UUID NOT NULL
role varchar NOT NULL -- owner|admin|member|viewer
status varchar NOT NULL -- ACTIVE|SUSPENDED|REMOVED
joined_at timestamptz NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
UNIQUE(family_id,user_id)
```

`user_id` è ID remoto verso Identity, non FK.

### invites

```text
id UUID PK
family_id UUID NOT NULL
email varchar NULL
role varchar NOT NULL -- admin|member|viewer
token_hash varchar(128) UNIQUE NOT NULL
status varchar NOT NULL -- pending|accepted|revoked|expired
expires_at timestamptz NOT NULL
accepted_by_user_id UUID NULL
accepted_at timestamptz NULL
fallback_code varchar(64) NULL
created_by_user_id UUID NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

Il token raw non viene persistito.

### join_attempts

```text
id UUID PK
invite_id UUID NOT NULL REFERENCES invites(id) ON DELETE CASCADE
user_id UUID NOT NULL
browser_binding_hash varchar(128) NOT NULL
state varchar(32) NOT NULL -- PENDING_REVIEW|ACCEPTED|REJECTED|EXPIRED
expires_at timestamptz NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL DEFAULT 1
```

`user_id` is a remote Identity ID. `invite_id` is a local Family FK.

## 6. inventory_db

### pantry_items — stato corrente

```text
id UUID PK
family_id UUID NOT NULL
product_id UUID NOT NULL
lot_id UUID NULL REFERENCES pantry_lots(id)
quantity numeric(14,3) NOT NULL CHECK(quantity > 0)
unit varchar(16) NOT NULL
location varchar(32) NULL
opened_at timestamptz NULL
expires_at timestamptz NULL
expiration_source varchar NULL -- declared|estimated
lot_code varchar(100) NULL
added_at timestamptz NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

**Invariant:** una riga `pantry_items` esiste solo se quantity > 0. Quantity zero non è uno stato persistente.

### pantry_lots

```text
id UUID PK
family_id UUID NOT NULL
product_id UUID NOT NULL
lot_code varchar(100) NULL
received_at timestamptz NOT NULL
best_before_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### movements

```text
id UUID PK
family_id UUID NOT NULL
pantry_item_id UUID NULL
product_id UUID NOT NULL
type varchar NOT NULL -- add|consume|waste|adjust|remove
quantity numeric(14,3) NOT NULL CHECK(quantity > 0)
unit varchar(16) NOT NULL
reason varchar(64) NULL
actor_user_id UUID NOT NULL
occurred_at timestamptz NOT NULL
metadata JSONB NULL
created_at timestamptz NOT NULL
```

Il movimento storico può riferirsi a un pantry_item_id non più presente. `lot_id`, quando valorizzato, è FK locale a `pantry_lots`.

## 7. catalog_db

All authoritative Catalog tables use the public schema in the current migration set.

### products

```text
id UUID PK
canonical_name varchar(300) NOT NULL
brand_id UUID NULL REFERENCES brands(id)
default_unit varchar(16) NOT NULL -- g|kg|ml|l|piece|pack
status varchar(32) NOT NULL -- ACTIVE
provenance_quality varchar(32) NOT NULL -- VERIFIED|IMPORTED|ESTIMATED|UNKNOWN
version integer NOT NULL
category varchar(120) NULL
photo_url varchar(1000) NULL
calories_per_100 numeric(12,3) NULL
protein_per_100 numeric(12,3) NULL
carbs_per_100 numeric(12,3) NULL
fat_per_100 numeric(12,3) NULL
fiber_per_100 numeric(12,3) NULL
nutrition_confidence varchar(32) NULL
quantity_value numeric(12,3) NULL -- normalized numeric package quantity from OFF product_quantity when available
quantity_unit varchar(16) NULL -- original OFF package unit; may be outside InventoryUnit
quantity_label varchar(120) NULL -- original human-readable OFF quantity field
serving_size varchar(120) NULL
serving_quantity numeric(12,3) NULL
images_json JSONB NULL -- normalized front/ingredients/nutrition/packaging image URLs
openfoodfacts_raw JSONB NULL -- complete original OFF product object, excluding private cache metadata
external_source varchar(128) NULL
external_ref varchar(255) NULL
external_synced_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

### product_identifiers

```text
id UUID PK
product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE
source_id UUID NOT NULL REFERENCES data_sources(id)
identifier_type varchar(32) NOT NULL
normalized_value varchar(100) NOT NULL
is_verified boolean NOT NULL DEFAULT false
created_at timestamptz NOT NULL
UNIQUE(source_id,identifier_type,normalized_value)
UNIQUE(identifier_type,normalized_value) -- barcode is globally unambiguous in Catalog
```

### data_sources

```text
id UUID PK
kind varchar(32) NOT NULL
name varchar(128) NOT NULL
created_at timestamptz NOT NULL
UNIQUE(kind,name)
```

### data_provenance

```text
id UUID PK
entity_type varchar(64) NOT NULL
entity_id UUID NOT NULL
source_id UUID NOT NULL REFERENCES data_sources(id)
observed_at timestamptz NOT NULL
source_version varchar(128) NOT NULL
confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1)
raw_ref varchar(500) NULL
```

Product IDs referenced by other domains are remote IDs; they are never cross-database foreign keys.
## 8. shopping_db

All authoritative Shopping tables use schema `shopping_domain`.

### shopping_domain.lists

```text
id UUID PK
family_id UUID NOT NULL
name varchar(120) NOT NULL
status varchar(16) NOT NULL -- open|closed
created_by_user_id UUID NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL DEFAULT 1
```

### shopping_domain.items

```text
id UUID PK
list_id UUID NOT NULL REFERENCES shopping_domain.lists(id) ON DELETE CASCADE
product_id UUID NULL
label varchar(300) NOT NULL
quantity numeric(14,3) NOT NULL CHECK(quantity > 0)
unit varchar(16) NOT NULL
checked boolean NOT NULL DEFAULT false
source varchar(32) NOT NULL DEFAULT 'manual'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL DEFAULT 1
```

Only `list_id` is a local FK. `product_id` is a remote Catalog ID.
## 9. notifications_db

All authoritative Notifications tables use schema `notifications_domain`.

### notifications_domain.notifications

```text
id UUID PK
user_id UUID NOT NULL
family_id UUID NULL
type varchar(64) NOT NULL
title varchar(200) NOT NULL
body text NOT NULL
payload JSONB NULL
read_at timestamptz NULL
created_at timestamptz NOT NULL DEFAULT now()
expires_at timestamptz NULL
version integer NOT NULL DEFAULT 1
```

### notifications_domain.preferences

```text
user_id UUID PK
expiration boolean NOT NULL DEFAULT true
low_stock boolean NOT NULL DEFAULT true
offers boolean NOT NULL DEFAULT false
family boolean NOT NULL DEFAULT true
system boolean NOT NULL DEFAULT true
in_app boolean NOT NULL DEFAULT true
email boolean NOT NULL DEFAULT false
push boolean NOT NULL DEFAULT false
updated_at timestamptz NOT NULL DEFAULT now()
version integer NOT NULL DEFAULT 1
```

### notifications_domain.idempotency_keys

Same common Idempotency contract as section 3, scoped to notifications_db.

### notifications_domain.outbox_events

Same common Outbox contract as section 3, scoped to notifications_db.

## 10. privacy_db

### privacy_consents

```text
user_id UUID NOT NULL
purpose varchar(100) NOT NULL
granted boolean NOT NULL
consent_version varchar(64) NOT NULL
updated_at timestamptz NOT NULL
PRIMARY KEY(user_id,purpose)
```

### privacy_erasure_requests

```text
id UUID PK
family_id UUID NOT NULL
requester_id UUID NOT NULL
idempotency_key varchar(255) NOT NULL
status varchar NOT NULL -- REQUESTED|PROCESSING|COMPLETED|FAILED
created_at timestamptz NOT NULL
completed_at timestamptz NULL
UNIQUE(family_id,idempotency_key)
```

### privacy_export_jobs

```text
id UUID PK
family_id UUID NOT NULL
owner_id UUID NOT NULL
idempotency_key varchar(255) NOT NULL
status varchar NOT NULL -- PENDING|COMPLETED|FAILED|EXPIRED
artifact_id UUID NULL
expires_at timestamptz NULL
created_at timestamptz NOT NULL
UNIQUE(family_id,idempotency_key)
```

### export_artifacts

```text
id UUID PK
family_id UUID NOT NULL
content JSONB NOT NULL
expires_at timestamptz NOT NULL
created_at timestamptz NOT NULL
```

### audit_events

```text
id UUID PK
family_id UUID NULL
actor_id UUID NULL
action varchar(128) NOT NULL
resource_type varchar(128) NOT NULL
resource_id UUID NULL
outcome varchar(32) NOT NULL
reason text NULL
trace_id varchar(128) NOT NULL
metadata JSONB NOT NULL
created_at timestamptz NOT NULL
```

Privacy uses the common `outbox_events` and `idempotency_keys` tables from section 3 in `privacy_db`.

## 11. jobs_db

### jobs

```text
id UUID PK
family_id UUID NULL
capability varchar(100) NOT NULL
status varchar(16) NOT NULL -- PENDING|PROCESSING|COMPLETED|FAILED|CANCELLED|DEGRADED
idempotency_key varchar(255) NOT NULL
max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts >= 1)
current_attempt integer NOT NULL DEFAULT 0 CHECK(current_attempt >= 0)
next_attempt_at timestamptz NOT NULL DEFAULT now()
result_ref JSONB NULL
last_error_code varchar(128) NULL
last_error_class varchar(16) NULL -- TRANSIENT|PERMANENT
trace_id varchar(128) NULL
payload JSONB NOT NULL
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
UNIQUE(capability,idempotency_key)
```

### job_attempts

```text
id UUID PK
job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE
attempt integer NOT NULL
started_at timestamptz NOT NULL
finished_at timestamptz NULL
status varchar(16) NOT NULL
error_code varchar(128) NULL
error_class varchar(16) NULL
duration_ms integer NULL
UNIQUE(job_id,attempt)
```

### dead_letter_jobs

```text
id UUID PK
job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE
queue varchar(128) NOT NULL
reason text NOT NULL
error_code varchar(128) NULL
error_class varchar(16) NULL
attempts integer NOT NULL
replay_count integer NOT NULL DEFAULT 0
failed_at timestamptz NOT NULL
original_created_at timestamptz NOT NULL
```

### audit_events

```text
id UUID PK
actor_id UUID NULL
action varchar(128) NOT NULL
resource_type varchar(128) NOT NULL
resource_id UUID NULL
outcome varchar(32) NOT NULL
reason text NULL
trace_id varchar(128) NOT NULL
created_at timestamptz NOT NULL DEFAULT now()
```

### inbox_events

```text
id UUID PK
consumer_name varchar(128) NOT NULL
event_id UUID NOT NULL
processed_at timestamptz NULL
outcome varchar(32) NULL
UNIQUE(consumer_name,event_id)
```
## 12. recipes_db

### recipes

```text
id UUID PK
owner_user_id UUID NOT NULL
family_id UUID NOT NULL
title varchar(300) NOT NULL
servings numeric(8,2) NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### recipe_ingredients

```text
id UUID PK
recipe_id UUID NOT NULL
product_id UUID NULL
name varchar(300) NOT NULL
quantity numeric(14,3) NOT NULL
unit varchar(16) NOT NULL
created_at timestamptz NOT NULL
```

### recipe_steps

```text
id UUID PK
recipe_id UUID NOT NULL
position integer NOT NULL
instruction text NOT NULL
UNIQUE(recipe_id,position)
```

## 13. nutrition_db

### targets

```text
user_id UUID PK
calories_kcal numeric(10,2) NOT NULL
protein_g numeric(10,2) NOT NULL
carbs_g numeric(10,2) NOT NULL
fat_g numeric(10,2) NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### diary_entries

```text
id UUID PK
user_id UUID NOT NULL
date date NOT NULL
meal varchar(32) NOT NULL
product_id UUID NOT NULL
quantity numeric(14,3) NOT NULL CHECK(quantity > 0)
unit varchar(16) NOT NULL
source varchar(32) NOT NULL -- manual|inventory
source_movement_id UUID NULL
nutrition_snapshot JSONB NULL -- immutable Catalog snapshot captured when the diary entry is recorded
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

source_movement_id è un ID remoto e non una FK.

## 14. stores_db

All authoritative Stores tables use schema `stores_domain`.

### stores_domain.stores

```text
id UUID PK
name varchar(300) NOT NULL
chain varchar(200) NULL
address text NULL
latitude numeric(9,6) NULL
longitude numeric(9,6) NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### stores_domain.prices

```text
id UUID PK
store_id UUID NOT NULL REFERENCES stores_domain.stores(id) ON DELETE CASCADE
product_id UUID NOT NULL
amount_minor bigint NOT NULL CHECK(amount_minor >= 0)
currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$')
observed_at timestamptz NOT NULL
source varchar(64) NOT NULL
created_at timestamptz NOT NULL
```

### stores_domain.offers

```text
id UUID PK
store_id UUID NOT NULL REFERENCES stores_domain.stores(id) ON DELETE CASCADE
product_id UUID NOT NULL
type varchar(32) NOT NULL -- percentage|fixed
value numeric(12,4) NOT NULL CHECK(value > 0)
valid_from timestamptz NOT NULL
valid_to timestamptz NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
CHECK(valid_from < valid_to)
CHECK(type <> 'percentage' OR value <= 100)
```

product_id is a remote Catalog ID; store_id is a local FK.

## 15. shelf_life_db

All authoritative Shelf-Life tables use schema `shelf_life_domain`.

### shelf_life_domain.rules

```text
id UUID PK
product_category varchar(120) NULL
storage varchar(32) NOT NULL -- PANTRY|FRIDGE|FREEZER|CELLAR|OTHER
opened boolean NOT NULL
min_days integer NOT NULL CHECK(min_days >= 0)
target_days integer NULL CHECK(target_days >= min_days)
max_days integer NOT NULL CHECK(max_days >= target_days)
model_version varchar(64) NOT NULL
active boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
UNIQUE(product_category,storage,opened,model_version) using normalized NULL semantics
```

### shelf_life_domain.product_profiles

```text
id UUID PK
product_id UUID NOT NULL -- remote Catalog ID, never a cross-database FK
storage varchar(32) NOT NULL -- PANTRY|FRIDGE|FREEZER|CELLAR|OTHER
opened boolean NOT NULL
min_days integer NOT NULL CHECK(min_days >= 0)
target_days integer NOT NULL CHECK(target_days >= min_days)
max_days integer NOT NULL CHECK(max_days >= target_days)
model_version varchar(64) NOT NULL
active boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
UNIQUE(product_id,storage,opened,model_version)
```

`product_profiles` overrides category rules for an exact Catalog product/storage/opened combination.

### shelf_life_domain.predictions

```text
id UUID PK
user_id UUID NOT NULL
family_id UUID NULL
item_id UUID NOT NULL
product_id UUID NOT NULL
storage varchar(32) NULL -- persisted prediction input
opened boolean NULL
category varchar(120) NULL
stored_on timestamptz NULL
estimated_expires_at timestamptz NOT NULL
confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1)
basis varchar(200) NOT NULL
model_version varchar(64) NOT NULL
status varchar(32) NOT NULL -- queued|completed|applied|superseded|failed
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

`item_id` and `product_id` are remote IDs. Shelf-Life never writes Inventory state directly. `storage`, `opened`, `category` and `stored_on` persist the exact estimation inputs so queued/completed work can be recovered after transport loss. `user_id`/`family_id` enforce read/apply ownership.

## 16. ocr_db

All authoritative OCR tables use schema `ocr_domain`.

### ocr_domain.ocr_jobs

```text
id UUID PK
user_id UUID NOT NULL
family_id UUID NULL
type varchar(32) NOT NULL -- receipt|pantry_image
object_key varchar(500) NOT NULL
status varchar(32) NOT NULL -- queued|processing|completed|failed|cancelled|needs_review
progress smallint NOT NULL CHECK(progress BETWEEN 0 AND 100)
error_code varchar(100) NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### ocr_domain.ocr_drafts

```text
id UUID PK
job_id UUID NOT NULL REFERENCES ocr_domain.ocr_jobs(id) ON DELETE CASCADE
confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1)
status varchar(32) NOT NULL -- draft|confirmed|rejected
raw_result JSONB NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### ocr_domain.ocr_draft_items

```text
id UUID PK
draft_id UUID NOT NULL REFERENCES ocr_domain.ocr_drafts(id) ON DELETE CASCADE
name varchar(300) NOT NULL
barcode varchar(64) NULL
quantity numeric(14,3) NULL
unit varchar(16) NULL
price_minor bigint NULL
currency char(3) NULL
confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1)
product_id UUID NULL
```

## 17. off_lookup_db — MongoDB

Collection `products` minima:

```json
{
  "_id": "off:1234567890123",
  "barcode": "1234567890123",
  "source": "openfoodfacts",
  "externalId": "1234567890123",
  "data": {},
  "rawHash": "sha256",
  "fetchedAt": "2026-09-30T15:30:00Z",
  "expiresAt": "2027-09-30T15:30:00Z"
}
```

Il dump OpenFoodFacts vive qui. Nessun servizio tratta questa collection come pantry state.

## 18. MinIO

Object keys currently used by the application:

```text
products/{productId}/{assetId}
ocr/{jobId}/{assetId}
privacy/{userId}/{jobId}
attachments/{ownerType}/{ownerId}/{assetId}
```

`object_key` is authoritative only as a reference from the owning domain record. Checksum/content-type/size metadata are not yet separate authoritative tables and MUST NOT be assumed to be persisted unless explicitly added to the owner migration and this contract.

## 19. Regole di integrità non negoziabili

- Nessun database contiene tabelle condivise.
- Nessun ORM può usare la connection string di un altro service.
- Nessun migration package crea tabelle fuori dal proprio DB.
- Nessuna cross-service FK o JOIN.
- Nessun trigger chiama un altro service.
- Una mutation multi-dominio è una saga/event workflow.
- Projection locali possono duplicare dati necessari alla lettura, ma sono non-authoritative.
- Una projection persa deve poter essere ricostruita.
- Inventory non conserva prodotti a quantità zero nello stato corrente.
- Catalog è owner del prodotto canonico; OFF Lookup è solo cache/provider data.


## 20. Consumer event deduplication

Ogni database di un servizio che consuma eventi deve avere una tabella locale equivalente a:

```text
processed_events
- event_id UUID PK
- event_type varchar(128) NOT NULL
- schema_version integer NOT NULL
- producer varchar(128) NOT NULL
- processed_at timestamptz NOT NULL
```

Non è una tabella condivisa: appartiene esclusivamente al consumer DB.

La transazione consumer è:

```text
BEGIN
  INSERT processed_events(event_id, ...)
  -- se duplicate: nessun effetto e ACK
  APPLY local mutation/projection
COMMIT
ACK
```

## 21. Local foreign keys

Le FK sono ammesse solo nello stesso DB:

- family_db: `members.family_id -> families.id`; `invites.family_id -> families.id`; `join_attempts.invite_id -> invites.id`.
- inventory_db: `pantry_items.lot_id -> pantry_lots.id`.
- shopping_db: `shopping_domain.items.list_id -> shopping_domain.lists.id`.
- catalog_db: `product_identifiers.product_id -> products.id`; `product_identifiers.source_id -> data_sources.id`; `data_provenance.source_id -> data_sources.id`.
- jobs_db: `job_attempts.job_id -> jobs.id`; `dead_letter_jobs.job_id -> jobs.id`.
- recipes_db: `recipes_domain.recipe_ingredients.recipe_id -> recipes_domain.recipes.id`; `recipes_domain.recipe_steps.recipe_id -> recipes_domain.recipes.id`.
- ocr_db: `ocr_domain.ocr_drafts.job_id -> ocr_domain.ocr_jobs.id`; `ocr_domain.ocr_draft_items.draft_id -> ocr_domain.ocr_drafts.id`.
- stores_db: `stores_domain.prices.store_id -> stores_domain.stores.id`; `stores_domain.offers.store_id -> stores_domain.stores.id`.

Ogni FK non elencata deve essere considerata cross-domain vietata fino a esplicita documentazione.
## 22. Required indexes

Ogni migration deve creare almeno:

- tutte le PK/UNIQUE;
- family-scoped indexes per `family_id`;
- temporal indexes per `created_at`/event timestamps quando usati in retention o pagination;
- Inventory: `(family_id, product_id)`, `(family_id, expires_at)`, `(family_id, lot_id)`;
- Catalog: `barcode`, `provider+external_id`;
- Shopping: `(family_id, status)` e `list_id`;
- Notifications: `(user_id, read_at, created_at)`;
- Jobs: `(status, available_at)`, `deduplication_key`;
- OCR: `(status, created_at)`, `job_id`;
- Shelf-Life: `(item_id, status)`;
- Stores: `(store_id, product_id, observed_at)`, `(store_id, valid_from, valid_to)`.

Gli indici possono essere aggiunti se il benchmark lo dimostra, ma non devono alterare la semantica.

## 23. Domain invariants

### Family
- una coppia `(family_id,user_id)` identifica una sola membership;
- role ∈ owner|admin|member|viewer;
- una family deve avere almeno un owner;
- invite token raw non è persistito;
- accepted/revoked/expired invite non può essere riutilizzato.

### Inventory
- quantity corrente > 0;
- quantity consumata/wasted > 0;
- remaining quantity >= 0;
- non si può consumare/scartare più della quantità disponibile;
- unità incompatibili non vengono convertite implicitamente;
- zero => delete current row + append movement;
- movement è immutabile.

### Catalog
- barcode non ambiguo: uno stesso barcode non può riferirsi contemporaneamente a due prodotti canonici senza un conflitto esplicito;
- provider provenance è tracciata;
- openfoodfacts_raw conserva il documento provider per visualizzazione e forward compatibility; non è la source of truth del Catalogo;
- i campi normalizzati del Catalogo restano il contratto stabile consumato dagli altri servizi.

### Shopping
- quantity > 0;
- item appartiene a una lista locale;
- closed list non accetta mutation salvo endpoint esplicito di riapertura futura.

### OCR
- confidence ∈ [0,1];
- draft appartiene a un job locale;
- conferma è idempotente;
- draft confermato non viene modificato distruttivamente.

### Shelf-Life
- confidence ∈ [0,1];
- min_days <= max_days per ogni rule;
- prediction contiene modelVersion;
- prediction non modifica Inventory direttamente.

### Stores
- amount_minor >= 0;
- currency ISO 4217;
- valid_from < valid_to;
- percentage value è limitato a [0,100].

## 24. Retention and deletion

Ogni table deve dichiarare, in migration o retention policy, se è:

- current state;
- historical ledger;
- cache;
- audit;
- temporary job;
- projection.

La cancellazione privacy non può eliminare dati di un altro DB direttamente. Il service owner riceve un workflow di erasure e registra il proprio esito.

## 24A. Forbidden physical aliases

The following names are migration-era logical aliases only and MUST NOT be created as tables or schemas:

- `shopping_lists` -> use `shopping_domain.lists`.
- `shopping_items` -> use `shopping_domain.items`.
- `product_barcodes` -> use `product_identifiers`.
- `product_sources` -> use `data_sources` + `data_provenance`.
- `dead_letters` -> use `dead_letter_jobs`.
- `family_memberships` / `stock_items` / `stock_movements` are pre-2.0 names and MUST NOT be referenced by the current services.
## 25. Future schema evolution

Sono consentiti:
- nuove colonne nullable/default;
- nuove tabelle nello stesso bounded context;
- nuove projection;
- nuovi provider/source;
- nuovi modelVersion;
- nuovi eventi/versioni.

Sono breaking:
- modifica semantica di una colonna;
- cambio tipo incompatibile;
- rimozione di una colonna ancora usata da un contratto;
- trasferimento di ownership senza migration plan.

## OFF search data ownership and schema

### MongoDB

Database: `off_lookup_db`. Collection: `products`. Owner: `off-lookup`.

Il documento completo segue la forma Open Food Facts importata o appresa via API. Il campo `code` è la
chiave funzionale e deve avere indice ascending per lookup barcode e pagination del bootstrap.

La ricerca testuale utente NON usa MongoDB.

La quality gate OFF è `completeness >= 0.70`. il maintenance job rimuove dal corpus locale i prodotti sotto soglia o senza completezza numerica verificabile, il bootstrap espone solo documenti eleggibili e OpenSearch applica lo stesso filtro a ogni ricerca. I nuovi risultati live sotto soglia non vengono memorizzati nella cache Mongo né indicizzati. Non è richiesto né ammesso un indice `_keywords_1`:
la ricerca testuale appartiene a OpenSearch.

Per il bootstrap della projection, `off-lookup` espone solamente una projection source interna
contenente i campi necessari alla ricerca; i campi OFF non necessari non escono da questo boundary.
La pagina source usa:
- `cursor`: ultimo `code`;
- `limit`: 1..1000, default 500;
- ordinamento `code ASC`;
- risposta `{items,nextCursor}`.

### OpenSearch

Indice: `off-products-v1`. Owner: `search-indexer`.

Mapping minimo:

| Campo | Tipo | Indicizzazione |
|---|---|---|
| code | keyword | sì |
| name | text | analyzer `off_text` |
| nameExact | keyword | sì |
| brand | text | analyzer `off_text` |
| brandExact | keyword | sì |
| category | text | analyzer `off_text` |
| categoriesTags | keyword[] | sì |
| quantityLabel | text | analyzer `off_text` |
| imageUrl | keyword | no |
| productQuantity | double | sì |
| productQuantityUnit | keyword | sì |
| calories/protein/carbs/fat/fiber | double | sì |
| popularityKey | double | sì |
| completeness | double | sì; filtro minimo 0.70 |
| featureText | text | analyzer `off_text` |

`dynamic=false` impedisce che il documento OFF proiettato trasformi automaticamente ogni campo arbitrario in un mapping OpenSearch.

### Consistenza

Il rapporto Mongo -> OpenSearch è eventual-consistent e rebuildable. Un documento del dump può esistere
in Mongo prima che compaia nell'indice durante il bootstrap; in quel caso una ricerca testuale che non
trova risultati usa il provider Open Food Facts come fallback e il risultato viene salvato localmente.
Il bootstrap continua in parallelo fino a stato `complete`.

OpenSearch è autorevole per la ricerca testuale; MongoDB resta autorevole per il documento OFF completo
e per il lookup barcode.

### Nessun coupling con i DB applicativi

Il corpus OFF e la projection di ricerca non condividono tabelle PostgreSQL con Family, Inventory, Shopping o gli altri microservizi. `search-indexer` non può aprire una connessione a un DB di dominio per correggere un documento OFF.


## Notifications processed event table

`notifications_domain.processed_events` appartiene esclusivamente a `service-notifications` e implementa la deduplicazione degli eventi consumati.

Campi: `event_id` primary key, `event_type`, `schema_version`, `producer`, `processed_at`. È presente un indice su `processed_at DESC`. La tabella è tecnica del service e non è condivisa con altri database.


La projection OpenSearch usa `nameExact` e `brandExact` come keyword normalizzate per exact/prefix search. `searchText` non fa più parte della projection corrente: la ricerca lessicale usa direttamente `name`, `brand`, `category`, `featureText` e `quantityLabel`.
