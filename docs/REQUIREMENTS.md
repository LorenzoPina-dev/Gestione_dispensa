# Requirements — Functional Coverage & Acceptance

Questo documento è normativo. La matrice sotto dimostra che ogni funzione prevista ha un bounded context, un owner DB, un contratto HTTP e/o un contratto asincrono. Le implementazioni future possono estendere i contratti in modo compatibile senza cambiare ownership.

## 1. Architettura non negoziabile

| ID | Requisito |
|---|---|
| R-A01 | Microservizi indipendenti e deployabili. |
| R-A02 | Un database dedicato per ogni service owner. |
| R-A03 | Nessun accesso cross-database, FK cross-service o JOIN cross-service. |
| R-A04 | Ogni DB ha credenziali, migration, backup/restore e lifecycle propri. |
| R-A05 | HTTP/eventi sono contratti versionati. |
| R-A06 | Mutazione locale + Outbox nella stessa transazione. |
| R-A07 | Consumer idempotenti, retry bounded e DLQ. |
| R-A08 | Nginx è l'unico ingresso browser-facing. |
| R-A09 | OIDC authentication + authorization per user/family/role. |
| R-A10 | MinIO per blob; Redis/broker per infrastruttura transient. |
| R-A11 | Deploy, scaling e recovery indipendenti per service. |
| R-A12 | Nessuna transazione distribuita. |
| R-A13 | Gateway senza ownership di dominio o DB di dominio. |
| R-A14 | Projection e cache non sono source of truth. |
| R-A15 | Ogni feature ha contract test e integration test sul proprio owner. |

## 2. Matrice completa delle funzioni

| Funzione | Owner | DB | Contratto principale | Async/eventi |
|---|---|---|---|---|
| Registrazione/login OIDC | Keycloak + Identity linkage | identity_db | `GET/PATCH /identity/me` | Identity profile events |
| Profilo utente | Identity | identity_db | `GET/PATCH /identity/me` | UserProfileUpdated |
| Creazione famiglia | Family | family_db | `POST /families` | FamilyCreated |
| Membri/ruoli | Family | family_db | `GET /families/{id}` | FamilyMemberAdded/Removed |
| Inviti | Family | family_db | `POST /families/{id}/invites` | FamilyInviteCreated |
| Accettazione invito | Family | family_db | `POST /family-invites/{token}/accept` | FamilyMemberAdded |
| Revoca invito | Family | family_db | `DELETE /families/{id}/invites/{inviteId}` | FamilyInviteRevoked |
| Dispensa corrente | Inventory | inventory_db | `GET /inventory` | Pantry projections |
| Inserimento prodotto in dispensa | Inventory | inventory_db | `POST /inventory/items` | PantryItemAdded |
| Modifica quantità | Inventory | inventory_db | `PATCH /inventory/{itemId}` | PantryItemAdjusted |
| Consumo | Inventory | inventory_db | `POST /inventory/{itemId}/consume` | PantryItemConsumed |
| Spreco/scarto | Inventory | inventory_db | `POST /inventory/{itemId}/waste` | PantryItemWasted |
| Storico movimenti | Inventory | inventory_db | `GET /inventory/{itemId}/movements` | none required |
| Lotti | Inventory | inventory_db | Inventory item/lot contract | LotAdded/Adjusted |
| Quantità zero | Inventory | inventory_db | consume/waste response | `removed=true`; current row deleted |
| Prodotto canonico | Catalog | catalog_db | `GET/POST/PATCH /catalog/products` | ProductCreated/Enriched |
| Barcode | Catalog | catalog_db | `GET /catalog/barcodes/{barcode}` | ProductEnriched |
| OpenFoodFacts lookup | OFF Lookup | off_lookup_db | internal lookup contract | cache refresh/sync events |
| Cache read-through OFF | OFF Lookup | off_lookup_db | internal HTTP | OFF cache events |
| Immagini prodotto | Catalog + MinIO | catalog_db + object store | catalog asset contract | ProductEnriched |
| Scansione immagine pantry | OCR/Vision workflow | ocr_db | `POST /ocr/jobs` type=pantry_image | OcrDraftReady |
| OCR scontrino | OCR | ocr_db | `POST /ocr/jobs` type=receipt | OcrDraftReady |
| Conferma OCR | service owner | owner DB | `POST /ocr/drafts/{id}/confirm` | domain mutation events |
| Stima scadenza | Shelf-Life | shelf_life_db | `POST/GET /shelf-life/predictions` | ExpirationEstimated |
| Conferma scadenza reale | Inventory | inventory_db | `POST /inventory/{itemId}/expiration/confirm` | ExpirationConfirmed |
| Notifiche scadenza | Notifications | notifications_db | notifications contract | event consumer |
| Low-stock | Inventory | inventory_db | inventory threshold policy | PantryLowStock |
| Suggerimento spesa | Shopping | shopping_db | shopping lists/items | ShoppingItemSuggested |
| Lista spesa | Shopping | shopping_db | `/shopping/lists*` | shopping events |
| Negozi | Stores | stores_db | `/stores` | StoreUpdated |
| Prezzi | Stores | stores_db | `/stores/{id}/prices` | PriceObserved |
| Offerte | Stores | stores_db | `/stores/{id}/offers` | OfferUpdated |
| Ricette | Recipes | recipes_db | `/recipes*` | RecipeCreated/Updated |
| Suggerimenti ricette | Recipes | recipes_db | `GET /recipes/suggestions` | projections/events |
| Diario nutrizionale | Nutrition | nutrition_db | `/nutrition/diary` | NutritionEntryRecorded |
| Target nutrizionali | Nutrition | nutrition_db | `/nutrition/targets` | TargetUpdated |
| Privacy/consensi | Privacy | privacy_db | `/privacy/consents` | ConsentUpdated |
| Export dati | Privacy | privacy_db + MinIO | `POST /privacy/export` | PrivacyExportCompleted |
| Cancellazione dati | Privacy | privacy_db + owner DBs | `POST /privacy/erase` | PrivacyErasureRequested/*Completed |
| Job lifecycle | Jobs | jobs_db | internal job contract | JobQueued/Failed/Completed |
| Dashboard | Gateway | none | `GET /dashboard` | read-only composition |
| Search | Search/indexer | dedicated projection/index | future/internal contract | rebuildable projections |
| Analytics | Analytics/projection | dedicated future DB | future/internal contract | consumes domain events |

## 3. Source of truth

Ogni informazione authoritative appartiene a un solo owner:

- Identity: profilo/link OIDC.
- Family: membership e ruoli.
- Inventory: stato corrente della dispensa e ledger.
- Catalog: prodotto canonico e barcode.
- OFF Lookup: dati provider/cache OpenFoodFacts.
- Shopping: liste e articoli.
- Stores: negozi, prezzi e offerte.
- Recipes: ricette.
- Nutrition: diario e target.
- Notifications: notifiche e preferenze.
- Shelf-Life: regole e prediction.
- OCR: job e draft OCR.
- Privacy: consensi e workflow privacy.
- Jobs: lifecycle tecnico dei job.
- MinIO: blob; il service owner mantiene i metadati di ownership.
- Redis/broker: trasporto/cache/lock transient, mai source of truth.

## 4. Regole funzionali critiche

### Inventory

1. `quantity > 0` è obbligatorio nello stato corrente.
2. Consume/waste sono transazioni atomiche.
3. Se la quantità raggiunge zero, la riga corrente viene eliminata nella stessa transazione.
4. Il movimento storico rimane.
5. Non si usa soft-delete per pantry state.
6. Una data dichiarata ha precedenza sulla prediction.
7. Shelf-Life non modifica direttamente Inventory.

### Barcode

1. Preservare gli zeri iniziali.
2. Cercare prima nella cache OFF.
3. Se assente/stale, consultare provider remoto secondo policy.
4. Salvare la risposta normalizzata/raw secondo retention.
5. Catalog decide cosa diventa dato canonico.
6. Inventory viene modificato solo dopo conferma/applicazione esplicita.

### OCR/Vision

1. Il file viene salvato in MinIO.
2. Il job è asincrono.
3. OCR/Vision produce un draft con confidence.
4. Il draft non modifica automaticamente il dominio.
5. L'utente conferma o corregge.
6. La mutation finale appartiene al service owner.

### Shelf-Life

1. La prediction è sempre identificata come estimated.
2. Deve conservare confidence, basis e modelVersion.
3. La prediction è riproducibile/tracciabile.
4. Una nuova prediction può supersedere una precedente.
5. La data dichiarata può sostituire una prediction.
6. Nessun modello futuro può modificare direttamente il DB Inventory.

### Privacy

1. Export/erasure sono workflow asincroni.
2. Ogni service elimina/anonymizza i propri dati.
3. Nessun orchestratore esegue SQL sugli altri DB.
4. Il workflow deve essere retryable e auditabile.

## 5. Contratti HTTP

Ogni endpoint deve avere:

- path;
- metodo;
- auth requirement;
- path/query/header schema;
- request schema;
- response schema;
- status code;
- error code;
- idempotency;
- concurrency policy;
- ownership;
- eventuali side effects;
- eventuale evento prodotto.

La specifica machine-readable è `openapi.yaml`.

## 6. Contratti evento

Ogni evento deve avere:

- eventId;
- eventType;
- schemaVersion;
- occurredAt;
- producer;
- aggregateId;
- familyId quando applicabile;
- correlationId;
- causationId;
- payload versionato.

Gli eventi non trasferiscono ownership.

## 7. Evoluzione futura

La piattaforma deve permettere senza modificare gli owner esistenti:

- nuovi provider barcode/OFF;
- nuovi modelli di shelf-life;
- nuovi canali notifiche;
- nuovi provider OCR/Vision;
- nuove fonti prezzi/offerte;
- ricerca avanzata/OpenSearch;
- recommendation/ML;
- analytics;
- integrazioni esterne;
- nuovi client web/mobile;
- nuove famiglie di eventi.

Le estensioni devono aggiungere capability tramite nuovi endpoint/eventi/versioni o nuovi consumer. Non devono creare accessi cross-DB.

## 8. Backward compatibility

Compatibile:
- nuovi campi opzionali;
- nuovi endpoint;
- nuovi consumer;
- nuove projection.

Breaking:
- cambiare tipo di campo;
- rendere obbligatorio un campo precedentemente opzionale;
- cambiare semantica;
- rimuovere un campo;
- cambiare enum in modo incompatibile.

Ogni breaking change richiede nuova versione del contratto.

## 9. Acceptance criteria

Una feature è accettata solo se:

1. owner e bounded context sono identificati;
2. DB e schema sono documentati;
3. migration esiste;
4. request/response sono documentati;
5. OpenAPI è aggiornato;
6. eventi sono documentati quando necessari;
7. authorization/tenant isolation è testata;
8. idempotency/concurrency è testata;
9. failure/retry è testato;
10. non esistono accessi cross-DB;
11. observability è definita;
12. test unit/integration/contract/E2E appropriati esistono;
13. la capability può essere estesa senza modificare ownership di altri domini.

## 10. Stato della verifica repository

La branch contiene già directory funzionali con naming storico e naming canonico. Questo è un **migration concern**, non una modifica del modello di ownership.

Naming canonico documentale:
- `service-family`
- `service-inventory`
- `service-catalog`
- `service-shelf-life`
- `service-ocr`
- `service-stores`
- `service-jobs`
- `service-privacy`

Directory storiche presenti nella branch devono essere mappate, consolidate o eliminate durante l'implementazione; non devono creare un secondo owner dello stesso dominio.

La presenza di una directory non viene considerata prova che la funzione sia già implementata: la conformità viene dimostrata dai contract/integration tests.

## 11. Quality gate finale

La documentazione è considerata completa quando:

```
function
 -> owner
 -> DB
 -> schema
 -> migration
 -> endpoint/event
 -> input
 -> output
 -> errors
 -> auth
 -> idempotency
 -> concurrency
 -> side effects
 -> tests
 -> observability
 -> recovery
```

è definito per ogni capability.

La documentazione descrive inoltre extension points, ma non li tratta come feature implementate finché non esistono codice e test.
