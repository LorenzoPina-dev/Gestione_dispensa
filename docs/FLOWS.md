# Flussi

## Barcode
Client -> Gateway -> Catalog -> OFF Lookup. OFF Lookup cerca MongoDB locale; se manca, provider OpenFoodFacts remoto e cache. Catalog normalizza; utente conferma; Inventory crea il prodotto e pubblica PantryItemAdded.

## Immagine
Upload -> MinIO -> job vision/OCR -> draft con confidence -> conferma utente -> service owner applica la mutazione.

## Scontrino
Upload MinIO -> OCR job -> OCR DB -> draft prodotti/prezzi -> conferma -> Catalog/Inventory/Stores.

## Scadenza
Inventory identifica il lotto -> Shelf-Life stima se manca la data reale -> prediction marcata estimated -> Notifications secondo policy. Una data dichiarata ha priorità.

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

## 10. Shelf-life estimation
When Inventory creates or reads a current pantry item without `expiresAt`, it asynchronously requests a Shelf-Life prediction. Catalog data is consulted for the product category when available; Shelf-Life falls back to a baseline rule when no category-specific rule exists. Worker executes the rule/model, stores confidence, basis and modelVersion, then applies the completed prediction through the Inventory owner API. Inventory sets `expiration_source=estimated`. A later declared date can replace it. The estimation is asynchronous and does not block the original pantry mutation.

## 11. Low stock and shopping
Inventory evaluates the configured threshold after relevant mutations. PantryLowStock is emitted. Shopping creates or updates a suggestion idempotently. Notifications may notify the user. Purchasing a shopping item never directly writes Inventory; actual pantry addition always goes through Inventory.

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
