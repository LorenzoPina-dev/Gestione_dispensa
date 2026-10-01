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
| shopping_db | Shopping | PostgreSQL | shopping_lists, shopping_items, outbox_events, idempotency_keys |
| catalog_db | Catalog | PostgreSQL | products, product_barcodes, product_sources, outbox_events, idempotency_keys |
| notifications_db | Notifications | PostgreSQL | notifications, preferences, outbox_events, idempotency_keys |
| privacy_db | Privacy | PostgreSQL | consents, privacy_jobs, erasure_requests, outbox_events, idempotency_keys |
| jobs_db | Jobs | PostgreSQL | jobs, job_attempts, dead_letters, outbox_events |
| recipes_db | Recipes | PostgreSQL | recipes, recipe_ingredients, recipe_steps, outbox_events, idempotency_keys |
| nutrition_db | Nutrition | PostgreSQL | targets, diary_entries, outbox_events, idempotency_keys |
| stores_db | Stores | PostgreSQL | stores, prices, offers, outbox_events, idempotency_keys |
| shelf_life_db | Shelf-Life | PostgreSQL | rules, predictions, outbox_events, idempotency_keys |
| ocr_db | OCR | PostgreSQL | ocr_jobs, ocr_drafts, ocr_draft_items, outbox_events, idempotency_keys |
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
email varchar NOT NULL
role varchar NOT NULL -- admin|member
token_hash varchar(128) UNIQUE NOT NULL
status varchar NOT NULL -- pending|accepted|revoked|expired
expires_at timestamptz NOT NULL
accepted_by_user_id UUID NULL
accepted_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

Il token raw non viene persistito.

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

### products

```text
id UUID PK
name varchar(300) NOT NULL
brand varchar(200) NULL
category varchar(120) NULL
image_object_key varchar(500) NULL
nutrition JSONB NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### product_barcodes

```text
id UUID PK
product_id UUID NOT NULL
barcode varchar(64) NOT NULL UNIQUE
type varchar(32) NOT NULL DEFAULT 'ean'
created_at timestamptz NOT NULL
```

### product_sources

```text
id UUID PK
product_id UUID NOT NULL
provider varchar(64) NOT NULL
external_id varchar(255) NOT NULL
raw_hash varchar(64) NULL
last_seen_at timestamptz NOT NULL
metadata JSONB NULL
UNIQUE(provider,external_id)
```

product_id è FK solo all'interno di catalog_db.

## 8. shopping_db

### shopping_lists

```text
id UUID PK
family_id UUID NOT NULL
name varchar(120) NOT NULL
status varchar NOT NULL -- open|closed|archived
created_by_user_id UUID NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### shopping_items

```text
id UUID PK
list_id UUID NOT NULL
product_id UUID NULL
label varchar(300) NOT NULL
quantity numeric(14,3) NOT NULL CHECK(quantity > 0)
unit varchar(16) NULL
checked boolean NOT NULL DEFAULT false
source varchar(32) NOT NULL -- manual|low_stock|suggestion
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

list_id è FK locale; product_id è remote Catalog ID.

## 9. notifications_db

### notifications

```text
id UUID PK
user_id UUID NOT NULL
family_id UUID NULL
type varchar(64) NOT NULL
title varchar(200) NOT NULL
body text NOT NULL
payload JSONB NULL
read_at timestamptz NULL
created_at timestamptz NOT NULL
expires_at timestamptz NULL
version integer NOT NULL
```

### preferences

```text
user_id UUID PK
expiration boolean NOT NULL
low_stock boolean NOT NULL
offers boolean NOT NULL
family boolean NOT NULL
system boolean NOT NULL
in_app boolean NOT NULL
email boolean NOT NULL
push boolean NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

## 10. privacy_db

### consents

```text
user_id UUID PK
analytics boolean NOT NULL
personalization boolean NOT NULL
notifications boolean NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### privacy_jobs

```text
id UUID PK
user_id UUID NOT NULL
type varchar NOT NULL -- export|erase
status varchar NOT NULL -- queued|processing|completed|failed
object_key varchar NULL
error_code varchar NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### erasure_requests

```text
id UUID PK
user_id UUID NOT NULL
requested_at timestamptz NOT NULL
confirmed_at timestamptz NOT NULL
status varchar NOT NULL
completed_at timestamptz NULL
```

## 11. jobs_db

### jobs

```text
id UUID PK
type varchar(100) NOT NULL
status varchar NOT NULL -- queued|running|completed|failed|cancelled
deduplication_key varchar(255) NULL
payload JSONB NOT NULL
attempt integer NOT NULL DEFAULT 0
max_attempts integer NOT NULL
available_at timestamptz NOT NULL
locked_at timestamptz NULL
locked_by varchar(128) NULL
last_error text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
UNIQUE(type,deduplication_key) WHERE deduplication_key IS NOT NULL
```

### job_attempts

```text
id UUID PK
job_id UUID NOT NULL
attempt integer NOT NULL
started_at timestamptz NOT NULL
finished_at timestamptz NULL
status varchar NOT NULL
error text NULL
```

### dead_letters

```text
id UUID PK
job_id UUID NULL
event_id UUID NULL
reason varchar NOT NULL
payload JSONB NOT NULL
failed_at timestamptz NOT NULL
resolved_at timestamptz NULL
```

## 12. recipes_db

### recipes

```text
id UUID PK
owner_user_id UUID NULL
family_id UUID NULL
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
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

source_movement_id è un ID remoto e non una FK.

## 14. stores_db

### stores

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

### prices

```text
id UUID PK
store_id UUID NOT NULL
product_id UUID NOT NULL
amount_minor bigint NOT NULL CHECK(amount_minor >= 0)
currency char(3) NOT NULL
observed_at timestamptz NOT NULL
source varchar(64) NOT NULL
created_at timestamptz NOT NULL
```

### offers

```text
id UUID PK
store_id UUID NOT NULL
product_id UUID NOT NULL
type varchar(32) NOT NULL -- percentage|fixed
value numeric(12,4) NOT NULL
valid_from timestamptz NOT NULL
valid_to timestamptz NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

## 15. shelf_life_db

### rules

```text
id UUID PK
product_category varchar(120) NULL
storage varchar(32) NOT NULL
opened boolean NOT NULL
min_days integer NOT NULL
max_days integer NOT NULL
model_version varchar(64) NOT NULL
active boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

### predictions

```text
id UUID PK
item_id UUID NOT NULL
product_id UUID NOT NULL
estimated_expires_at timestamptz NOT NULL
confidence numeric(5,4) NOT NULL CHECK(confidence >= 0 AND confidence <= 1)
basis varchar(200) NOT NULL
model_version varchar(64) NOT NULL
status varchar NOT NULL -- queued|completed|applied|superseded|failed
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

item_id e product_id sono ID remoti. Shelf-Life non modifica direttamente Inventory.

## 16. ocr_db

### ocr_jobs

```text
id UUID PK
user_id UUID NOT NULL
family_id UUID NULL
type varchar(32) NOT NULL -- receipt|pantry_image
object_key varchar(500) NOT NULL
status varchar NOT NULL -- queued|processing|completed|failed|cancelled
progress smallint NOT NULL CHECK(progress BETWEEN 0 AND 100)
error_code varchar(100) NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### ocr_drafts

```text
id UUID PK
job_id UUID NOT NULL
confidence numeric(5,4) NOT NULL
status varchar NOT NULL -- draft|confirmed|rejected
raw_result JSONB NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version integer NOT NULL
```

### ocr_draft_items

```text
id UUID PK
draft_id UUID NOT NULL
name varchar(300) NOT NULL
barcode varchar(64) NULL
quantity numeric(14,3) NULL
unit varchar(16) NULL
price_minor bigint NULL
currency char(3) NULL
confidence numeric(5,4) NOT NULL
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

Object key:

```text
products/{productId}/{assetId}
ocr/{jobId}/{assetId}
privacy/{userId}/{jobId}
attachments/{ownerType}/{ownerId}/{assetId}
```

Il DB owner conserva object key, checksum, content type, size e ownership.

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

- family_db: members.family_id -> families.id; invites.family_id -> families.id.
- inventory_db: pantry_items.lot_id -> pantry_lots.id.
- shopping_db: shopping_items.list_id -> shopping_lists.id.
- catalog_db: product_barcodes.product_id -> products.id; product_sources.product_id -> products.id.
- privacy_db: privacy_jobs/erasure_requests possono usare solo PK locali.
- jobs_db: job_attempts.job_id -> jobs.id; dead_letters.job_id -> jobs.id quando valorizzato.
- recipes_db: recipe_ingredients.recipe_id -> recipes.id; recipe_steps.recipe_id -> recipes.id.
- ocr_db: ocr_drafts.job_id -> ocr_jobs.id; ocr_draft_items.draft_id -> ocr_drafts.id.

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
- raw provider payload non è source of truth.

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

