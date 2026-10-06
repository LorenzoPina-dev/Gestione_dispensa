# Flussi

## Barcode
Client -> Gateway -> Catalog -> OFF Lookup. OFF Lookup cerca MongoDB locale; se manca, provider OpenFoodFacts remoto e cache. Catalog normalizza; utente conferma; Inventory crea il prodotto e pubblica PantryItemAdded.

## Immagine
Upload -> MinIO -> job vision/OCR -> draft con confidence -> conferma utente -> service owner applica la mutazione.

## Scontrino
Upload MinIO -> OCR job -> OCR DB -> draft prodotti/prezzi -> conferma -> Catalog/Inventory/Stores.

## Scadenza
Inventory identifica il lotto -> Shelf-Life stima se manca la data reale -> prediction marcata estimated -> Notifications secondo policy. Una data dichiarata ha priorità; quando il prodotto è stato aperto, `openedAt` modifica il profilo e l'ancoraggio della stima.

## Consumo/scarto
Inventory aggiorna atomicamente quantità e movimento. A zero rimuove la riga dallo stato corrente; il ledger storico resta.

## Spesa
Inventory emette low-stock -> Shopping crea/suggerisce articolo. L'acquisto confermato non scrive direttamente Inventory: l'inserimento passa da Inventory.

## Ricette/nutrizione
Recipes/Nutrition leggono disponibilità/eventi; il consumo reale passa sempre da Inventory.

## Inviti
Family crea token temporaneo -> Notifications -> destinatario autenticato -> accept -> Family verifica e crea membership -> audit/outbox. La sola scansione del token non concede accesso.

## Dashboard
Gateway può comporre in parallelo Family + Inventory + Shopping + Recipes + Notifications. È read-only composition; le mutation restano ai service owner.


# Complete flow specification

This section is normative for the end-to-end behavior.

## 1. Registration and login
Browser -> Nginx -> Keycloak/OIDC -> Gateway -> Identity -> identity_db. Identity maintains subject-to-userId linkage. Credentials remain owned by Keycloak.

## 2. Family and invitation
Family creation is one local transaction: family + owner membership + outbox. Invitation stores only a cryptographic token hash. Preview never grants membership. Accept verifies authenticated subject, token status and expiry, then atomically consumes the invite and creates membership. Replay, revoked, expired or tampered tokens never create membership.

## 3. Barcode
Scanner -> Gateway -> Catalog -> OFF Lookup -> MongoDB cache. Cache miss/stale data can call the external provider and populate the cache. Catalog normalizes and records provenance. User confirmation is required before Inventory creates pantry state.

## 4. Manual pantry entry
Gateway -> Catalog create/reuse product -> Inventory add item. Inventory never silently creates canonical product data.

## 5. Pantry image scan
Upload -> MinIO -> OCR/vision job -> OCR draft + confidence -> user review -> confirmation -> Catalog resolution if needed -> Inventory mutation. A draft never mutates pantry state automatically.

## 6. Receipt OCR
Upload -> MinIO -> OCR job -> OCR DB -> worker OCR -> draft containing product candidate, barcode, quantity, unit, price and confidence -> user confirmation. After confirmation, Catalog resolves products, Stores records observed prices, and Inventory records purchased quantities. These are separate idempotent mutations; no distributed transaction is used.

## 7. Consume
Inventory locks the current row, verifies family ownership and available quantity, appends an immutable movement, decrements quantity and emits PantryItemConsumed in the same transaction. If remaining quantity is zero, the current row is deleted and the response/event contains removed=true. History remains.

## 8. Waste
Same atomic protocol as consume, with movement type waste and reasons spoiled, expired, damaged or other. Zero quantity removes the current row while retaining history.

## 9. Real expiration date
Inventory accepts a declared expiration date, sets expiration_source=declared and emits ExpirationConfirmed. A declared date has precedence over an estimated prediction.

## 10. Shelf-Life estimation
When Inventory creates or reads a current pantry item without `expiresAt`, it asynchronously requests a Shelf-Life prediction. Catalog classification uses Open Food Facts taxonomy and product-name fallback to assign a specific shelf-life category (for example confectionery, chocolate, biscuits, dry staples, canned/preserved, fresh meat/fish and dairy). Existing Open Food Facts products are reclassified by Catalog migration when their category is missing.

Shelf-Life applies a strict precedence: declared package date > exact product-specific profile > category-specific profile compatible with storage/opened state > generic baseline only when the category is unknown. A recognized category with an incompatible storage state does not receive a generic estimate.

Each profile contains a conservative minimum, a recommended target and a maximum window. The recommended target is used as the single UI date, while confidence and basis identify how that date was produced. The estimate is anchored to Inventory `added_at` for existing items instead of resetting the clock at every retry/read. Worker executes the profile, stores confidence/basis/modelVersion, then applies the completed prediction through the Inventory owner API. Inventory sets `expiration_source=estimated`. A later declared date can replace it. The estimation is asynchronous and does not block the original pantry mutation.

These values are heuristics for conservability/quality, not manufacturer-certified expiration dates. Storage conditions materially affect shelf-life, so damaged packaging, abnormal temperature, moisture, heat, light or prolonged exposure can make the estimate inappropriate.
## 11. Low stock and shopping
Every tracked product has a durable reorder policy. The default is `reorderPoint=0` and `reorderQuantity=1`: when the product is completely exhausted, Inventory emits `PantryLowStock`. Shopping creates or updates one persistent suggestion idempotently. The suggestion is shown in `+ -> Scorte`; it becomes a shopping-list item only when the user adds it. Existing exhausted products are recovered by the Inventory backfill migration. Notifications may notify the user. Purchasing a shopping item never directly writes Inventory; actual pantry addition always goes through Inventory.

## 12. Shopping
Shopping owns list/item creation, editing, checking, deletion and closing. Product IDs are remote Catalog IDs. A closed list cannot be mutated except by a future explicitly documented reopen contract.

## 13. Stores, prices and offers
Imports/manual input -> Stores -> stores_db -> Store/Price/Offer events. Other domains consume projections or events; they never write stores_db.

## 14. Recipes
Recipes owns recipes and ranking/suggestions. Inventory/Catalog information may be consumed through events or projections. Ranking can evolve from deterministic rules to ML without changing Inventory ownership.

## 15. Nutrition
Manual diary writes go to Nutrition. Inventory consumption events can create nutrition entries/projections. Consumers are idempotent by eventId. Nutrition never mutates Inventory.

## 16. Notifications
Domain events are consumed by Notifications, preferences are checked, a notification is persisted, then channel delivery is performed by worker-notifications. Email/push provider failure must not roll back the originating domain mutation.

## 17. Privacy export
Privacy creates an asynchronous workflow. Each owner produces its own export fragment. Privacy creates the manifest/archive in MinIO. Privacy never queries another service DB directly.

## 18. Privacy erasure
Privacy requests erasure. Every affected owner deletes/anonymizes its own data and reports completion. The workflow is retryable, idempotent and auditable. No cross-DB SQL is allowed.

## 19. Jobs
Command/event -> Jobs -> queued -> worker claim -> processing -> success or bounded retry -> DLQ after maximum attempts. A worker crash after a side effect must be safe because the operation is idempotent or deduplicated.

## 20. Dashboard
Gateway performs parallel read-only calls to Family, Inventory, Shopping, Recipes and Notifications. A downstream timeout produces explicit partialFailures or a documented 503/504; the Gateway never fabricates authoritative data. Composite Views cannot mutate domain state.

## 21. Search
Domain event -> search-indexer -> rebuildable search projection. Search loss does not mean data loss because source-of-truth DBs remain authoritative.

## 22. Future capability pattern
New capability -> identify bounded context -> reuse existing owner or create new owner -> define DB if stateful -> define HTTP/events -> define invariants -> implement -> contract tests. Never add an unrelated domain table to another service merely to avoid creating a new owner.

## 23. Failure classes
Every flow distinguishes validation failure, authorization failure, business-rule failure, transient downstream failure, permanent provider failure, duplicate command, duplicate event, partial workflow and DLQ. Retryability and recovery are defined in OPERATIONS.md.

## Flusso: inserimento manuale tramite nome

```text
1. Utente apre "Cerca prodotto per nome".
2. Browser applica debounce e AbortController.
3. Browser -> Gateway -> Catalog -> off-lookup.
4. off-lookup -> OpenSearch locale.
5. Se ci sono hit: restituisce massimo K risultati ranked.
6. Se non ci sono hit oppure OpenSearch è indisponibile: off-lookup -> Search-a-licious.
7. L'utente sceglie una voce; il browser salva soltanto il code.
8. Browser -> Catalog POST /catalog/barcodes/resolve con quel code.
9. Catalog controlla il proprio catalogo PostgreSQL.
10. Se manca, off-lookup risolve exact code prima in Mongo e poi in OFF API v3.
11. off-lookup persiste il documento completo in Mongo e prova l'upsert OpenSearch in background.
12. Catalog persiste l'entità applicativa.
13. UI mostra il CandidateView con nome, categoria, confezione, immagini e nutrizione.
14. L'utente conferma e inserisce quantità, scadenza opzionale e luogo.
15. Inventory crea il current pantry item.
16. Se la scadenza è assente, Inventory avvia il normale workflow Shelf-Life asincrono.
```

### Failure semantics

- OpenSearch down: ricerca degrada al provider esterno.
- Provider esterno down dopo miss locale: 503, mai lista inventata.
- Mongo down durante selezione e provider OFF down: barcode resolution 503/degraded.
- Search index upsert down: il prodotto completo resta in Mongo/Catalog; l'errore di projection non blocca l'inserimento.
- Indicizzazione ritardata: il barcode flow resta funzionante.
- Reindex in corso: le normali ricerche continuano sull'indice precedente finché l'operazione non modifica l'indice; in caso di reset devono accettare la finestra documentata di disponibilità.

### Confini

Il Catalog non deve implementare il ranking OpenSearch. Il ranking appartiene al boundary search. Inventory non riceve mai direttamente un documento OpenSearch o un raw OFF: riceve il ProductId del Catalog.
