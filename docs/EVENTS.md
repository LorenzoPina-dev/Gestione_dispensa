# Event Contract

Questo documento definisce il contratto asincrono. Gli eventi sono versionati, immutabili e consumabili in modo idempotente.

## 1. Envelope obbligatorio

Ogni messaggio:

```json
{
  "eventId": "uuid",
  "eventType": "PantryItemAdded",
  "schemaVersion": 1,
  "occurredAt": "2026-09-30T15:30:00Z",
  "producer": "service-inventory",
  "aggregateId": "uuid",
  "familyId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid",
  "payload": {}
}
```

Regole:

- `eventId` unico globalmente.
- `eventType` case-sensitive e stabile.
- `schemaVersion` cambia quando cambia il payload in modo incompatibile.
- `producer` è il service owner dell'aggregate.
- `aggregateId` è l'ID dell'aggregate owner.
- `familyId` è obbligatorio per eventi family-scoped.
- `correlationId` identifica il workflow distribuito.
- `causationId` identifica l'evento/job che ha causato la mutation.
- `payload` non contiene segreti, token raw o credential.

## 2. Outbox e delivery

Il service owner esegue nella stessa transazione:

1. mutation locale;
2. incremento `version`;
3. insert outbox.

Il publisher invia l'evento e marca `publishedAt`. Il consumer:

1. verifica envelope/schema;
2. controlla idempotency;
3. aggiorna il proprio DB;
4. registra l'evento processato;
5. commit;
6. ACK.

Mai ACK prima del commit locale.

## 3. Consumer idempotency

Ogni consumer deve mantenere una deduplication record, oppure una chiave equivalente nel proprio DB:

```text
event_id UUID PK
event_type varchar
schema_version integer
producer varchar
processed_at timestamptz
```

Lo stesso `eventId` ricevuto due volte non deve produrre due effetti.

## 4. Retry/DLQ

Retry con backoff: 1s, 5s, 30s, 2m, 10m; massimo 5 tentativi salvo override documentato per evento.

Dopo il limite:

- evento/job in DLQ;
- errore persistito;
- metriche incrementate;
- nessun loop infinito;
- eventuale retry manuale crea una nuova attempt, non altera il payload originario.

## 5. Eventi di dominio

### ProductCreated v1

Producer: Catalog.

Payload:
```json
{
  "productId":"uuid",
  "name":"Latte intero",
  "brand":"Marca",
  "category":"milk",
  "barcodes":["8000000000000"]
}
```

### ProductEnriched v1

```json
{
  "productId":"uuid",
  "changedFields":["nutrition","imageObjectKey"],
  "source":{"provider":"openfoodfacts","externalId":"123"}
}
```

### PantryItemAdded v1

Producer: Inventory.

```json
{
  "itemId":"uuid",
  "productId":"uuid",
  "quantity":2,
  "unit":"L",
  "expiresAt":"2026-10-05T00:00:00Z",
  "expirationSource":"declared"
}
```

### PantryItemConsumed v1

```json
{
  "itemId":"uuid",
  "productId":"uuid",
  "quantity":1,
  "unit":"L",
  "remainingQuantity":1,
  "removed":false,
  "movementId":"uuid",
  "reason":"used"
}
```

Se `remainingQuantity=0`, `removed=true`.

### PantryItemWasted v1

```json
{
  "itemId":"uuid",
  "productId":"uuid",
  "quantity":2,
  "unit":"L",
  "remainingQuantity":0,
  "removed":true,
  "movementId":"uuid",
  "reason":"spoiled"
}
```

### PantryLowStock v1

```json
{
  "productId":"uuid",
  "currentQuantity":1,
  "unit":"L",
  "threshold":2
}
```

### ExpirationEstimated v1

Producer: Shelf-Life.

```json
{
  "predictionId":"uuid",
  "itemId":"uuid",
  "productId":"uuid",
  "estimatedExpiresAt":"2026-10-05T00:00:00Z",
  "confidence":0.81,
  "basis":"product_category+storage",
  "modelVersion":"shelf-life-1.0"
}
```

Shelf-Life non modifica Inventory direttamente.

### ExpirationConfirmed v1

Producer: Inventory.

```json
{
  "itemId":"uuid",
  "productId":"uuid",
  "expiresAt":"2026-10-05T00:00:00Z",
  "source":"declared"
}
```

### FamilyInviteCreated v1

```json
{
  "inviteId":"uuid",
  "familyId":"uuid",
  "recipientEmail":"invitee@example.com",
  "role":"member",
  "expiresAt":"2026-10-01T15:30:00Z"
}
```

Mai includere il token raw.

### FamilyMemberAdded v1

```json
{
  "membershipId":"uuid",
  "familyId":"uuid",
  "userId":"uuid",
  "role":"owner|admin|member|viewer"
}
```

### ShoppingItemSuggested v1

```json
{
  "listId":"uuid",
  "productId":"uuid",
  "label":"Latte",
  "quantity":2,
  "unit":"L",
  "source":"low_stock"
}
```

### OfferUpdated v1

```json
{
  "offerId":"uuid",
  "storeId":"uuid",
  "productId":"uuid",
  "type":"percentage",
  "value":20,
  "validFrom":"2026-09-30T00:00:00Z",
  "validTo":"2026-10-05T23:59:59Z"
}
```

### OcrDraftReady v1

```json
{
  "jobId":"uuid",
  "draftId":"uuid",
  "type":"receipt",
  "confidence":0.94,
  "itemCount":4
}
```

### JobFailed v1

```json
{
  "jobId":"uuid",
  "jobType":"ocr",
  "attempt":5,
  "maxAttempts":5,
  "errorCode":"OCR_PROVIDER_TIMEOUT",
  "retryable":false
}
```

Non includere stack trace o segreti nel payload pubblico.

### PrivacyExportCompleted v1

```json
{
  "jobId":"uuid",
  "userId":"uuid",
  "objectKey":"privacy/uuid/uuid",
  "expiresAt":"2026-10-07T15:30:00Z"
}
```

### PrivacyErasureRequested v1

```json
{
  "requestId":"uuid",
  "userId":"uuid",
  "requestedAt":"2026-09-30T15:30:00Z"
}
```

Ogni service ricevente elimina/anonymizza i propri dati secondo il contratto privacy e produce esito.

## 6. Ownership degli effetti

| Evento | Producer | Effetto ammesso |
|---|---|---|
| ProductCreated | Catalog | projection/lookup in altri servizi |
| ProductEnriched | Catalog | refresh projection |
| PantryItemAdded | Inventory | low-stock/projection |
| PantryItemConsumed | Inventory | Nutrition/Recipes projection |
| PantryItemWasted | Inventory | analytics/nutrition |
| PantryLowStock | Inventory | suggerimento Shopping/notifica |
| ExpirationEstimated | Shelf-Life | notifica/projection; non mutation Inventory |
| ExpirationConfirmed | Inventory | projection Shelf-Life/Notifications |
| FamilyInviteCreated | Family | invio notifica |
| FamilyMemberAdded | Family | projection/notifica |
| ShoppingItemSuggested | Shopping | UI/projection |
| OfferUpdated | Stores | projection Shopping |
| OcrDraftReady | OCR | UI workflow |
| JobFailed | Jobs/worker | notification/operations |
| Privacy* | Privacy | workflow privacy |

Un consumer non può usare un evento per scrivere direttamente il DB owner di un altro dominio.

## 7. Event compatibility

Schema v1 deve rimanere backward compatible quando possibile:

- aggiungere campo opzionale: compatibile;
- rendere obbligatorio un campo: breaking;
- cambiare tipo: breaking;
- cambiare semantica: nuova versione;
- rimuovere campo: nuova versione.

Per breaking change: nuovo `eventType` o `schemaVersion` e periodo di compatibilità esplicito.

## 8. Correlation

HTTP request -> job -> evento deve mantenere:

```text
X-Request-Id -> requestId
X-Correlation-Id -> correlationId
event.causationId -> id evento/job causale
```

Questo permette di ricostruire un workflow senza condividere database.


## 9. Complete event coverage

The following events are part of the canonical event vocabulary. A producer may add fields only according to compatibility rules.

### FamilyCreated v1
Producer: Family. Payload: familyId, name, createdByUserId.

### FamilyInviteRevoked v1
Producer: Family. Payload: inviteId, familyId, revokedAt.

### PantryItemAdjusted v1
Producer: Inventory. Payload: itemId, productId, previousQuantity, newQuantity, unit, movementId.

### LotAdded v1
Producer: Inventory. Payload: lotId, familyId, productId, lotCode, receivedAt.

### PriceObserved v1
Producer: Stores. Payload: priceId, storeId, productId, amountMinor, currency, observedAt, source.

### StoreUpdated v1
Producer: Stores. Payload: storeId, changedFields.

### RecipeCreated v1
Producer: Recipes. Payload: recipeId, familyId/user owner, title.

### RecipeUpdated v1
Producer: Recipes. Payload: recipeId, changedFields.

### NutritionEntryRecorded v1
Producer: Nutrition. Payload: entryId, userId, date, meal, productId, quantity, unit, source.

### NutritionTargetUpdated v1
Producer: Nutrition. Payload: userId, changedFields.

### OcrDraftConfirmed v1
Producer: OCR. Payload: draftId, jobId, type, confirmedAt, itemCount.

### OcrDraftRejected v1
Producer: OCR. Payload: draftId, jobId, rejectedAt.

### PrivacyExportRequested v1
Producer: Privacy. Payload: jobId, userId, requestedAt.

### PrivacyErasureCompleted v1
Producer: Privacy. Payload: requestId, userId, completedAt, serviceResults.

### JobQueued v1
Producer: Jobs. Payload: jobId, type, deduplicationKey.

### JobCompleted v1
Producer: Jobs/worker. Payload: jobId, type, completedAt.

Event names are stable identifiers. Internal implementation may use different class names, but emitted contracts must use these eventType values.


## 10. Runtime producer vocabulary

The following additional event types are emitted by the current runtime and are therefore part of the canonical vocabulary:

### ProductUpdated v1
Producer: Catalog. Payload: `{productId, changedFields}`.

### FamilyUpdated v1
Producer: Family. Payload: `{familyId, name, version}`.

### FamilyDeleted v1
Producer: Family. Payload: `{familyId}`.

### FamilyMemberUpdated v1
Producer: Family. Payload: `{userId, role, joinedAt, version}`.

### FamilyMemberRemoved v1
Producer: Family. Payload: `{userId}`.

### FamilyInviteRevoked v1
Producer: Family. Payload: `{inviteId}`.

### FamilyInviteAccepted v1
Producer: Family. Payload: `{familyId, userId, role, joinedAt}`.

### ShoppingListCreated v1
Producer: Shopping. Payload: `{listId, familyId, name, status, version}`.

### ShoppingItemAdded v1
Producer: Shopping. Payload: `{itemId, listId, productId, label, quantity, unit, checked, source, version}`.
`source` is optional at consumer level and currently uses `manual|recipe|low_stock|offer`. The Shopping API validates it against this set and returns it on every item.

### ShoppingItemUpdated v1
Producer: Shopping. Payload: `{itemId, listId, changedFields, version}`.

### ShoppingItemRemoved v1
Producer: Shopping. Payload: `{itemId, listId}`.

### ShoppingListClosed v1
Producer: Shopping. Payload: `{listId, status, version}`.

### NotificationRead v1
Producer: Notifications. Payload: `{notificationId, readAt}`.

### RecipeDeleted v1
Producer: Recipes. Payload: `{recipeId}`.

### ShelfLifePredictionQueued v1
Producer: Shelf-Life. Payload: `{predictionId, itemId, productId, storage, opened, category}`.

### ShelfLifePredictionCompleted v1
Producer: Shelf-Life. Payload: `{predictionId, estimatedExpiresAt, confidence, modelVersion}`.

### ShelfLifePredictionApplied v1
Producer: Shelf-Life. Payload: `{predictionId, itemId, status}`.

### OcrDraftConfirmed v1
Producer: OCR. Payload: `{draftId, jobId, type, confirmedAt, itemCount}`.

### OcrDraftRejected v1
Producer: OCR. Payload: `{draftId, jobId, rejectedAt}`.

Event payloads contain domain data only. HTTP envelopes, `meta`, access tokens, refresh tokens, QR raw tokens, fallback codes and database credentials are never part of an event payload.


## 11. Runtime boundary fixes

The runtime follows the ownership rules above:

- Inventory emits `inventory.stock.received.v1`, `inventory.stock.consumed.v1`, `inventory.stock.wasted.v1` and `inventory.expiration-confirmed.v1` from its own transaction.
- Shelf-Life consumes Inventory domain events and never calls Inventory to mutate stock.
- Shelf-Life emits `shelf-life.prediction-completed.v1`; Inventory consumes it and applies an estimated expiration only when a user-declared expiration has not won the race.
- Nutrition consumes `inventory.stock.consumed.v1` and creates its immutable nutrition snapshot locally. Inventory does not synchronously call Nutrition.
- Consumers use Redis Streams consumer groups and durable `event_consumers` records so delivery is at-least-once and effects are idempotent.
- Catalog enrichment uses bounded batch reads rather than one HTTP request per product.
