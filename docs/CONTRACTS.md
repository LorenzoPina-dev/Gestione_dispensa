# Contratti API ed eventi

## 1. Regole di compatibilita

- API pubbliche sotto `/api/v1`; breaking change solo con nuova major.
- Gli eventi hanno `eventType` e `eventVersion`; il consumer deve tollerare campi aggiuntivi.
- Campi obbligatori non vengono rimossi in una versione attiva.
- Producer e consumer applicano schema validation prima della business logic.
- Ogni comando ripetibile richiede `Idempotency-Key`; ogni evento richiede `eventId` univoco.
- `traceparent` W3C attraversa HTTP e messaggi.
- Errori client sono stabili per `code`, non per testo libero.
- Timestamp ISO-8601 UTC; quantità `decimal` string o number controllato, denaro sempre decimal.

## 2. Envelope HTTP

### Successo sincrono

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "traceId": "hex",
    "schemaVersion": "1.0"
  }
}
```

### Job asincrono

```json
{
  "data": {
    "jobId": "uuid",
    "status": "PENDING",
    "statusUrl": "/api/v1/jobs/uuid"
  },
  "meta": {
    "requestId": "uuid",
    "traceId": "hex"
  }
}
```

### Errore

```json
{
  "error": {
    "code": "INVENTORY_CONFLICT",
    "message": "The requested operation cannot be applied.",
    "details": [],
    "retryable": false
  },
  "meta": {
    "requestId": "uuid",
    "traceId": "hex"
  }
}
```

Non includere stack trace, SQL, token, prompt o dati di altri household.

## 3. Resource contract essenziali

### Product

```json
{
  "id": "uuid",
  "name": "string",
  "brand": "string|null",
  "categoryId": "uuid|null",
  "defaultUnit": "g|kg|ml|l|piece|pack",
  "identifiers": [{"type": "EAN13", "value": "string"}],
  "nutrition": {"sourceId": "uuid", "quality": "VERIFIED|IMPORTED|ESTIMATED|UNKNOWN"},
  "provenance": [{"sourceId": "uuid", "observedAt": "timestamp", "confidence": 0.0}],
  "updatedAt": "timestamp"
}
```

### Stock item

```json
{
  "id": "uuid",
  "householdId": "uuid",
  "productId": "uuid",
  "lotId": "uuid|null",
  "quantity": "decimal",
  "unit": "g|kg|ml|l|piece|pack",
  "reorderPoint": "decimal|null",
  "expiresAt": "timestamp|null",
  "locationId": "uuid|null",
  "version": 4,
  "updatedAt": "timestamp"
}
```

### Movement command

```json
{
  "stockItemId": "uuid",
  "kind": "RECEIPT|CONSUMPTION|WASTE|ADJUSTMENT|TRANSFER",
  "quantity": "decimal",
  "unit": "g|kg|ml|l|piece|pack",
  "reason": "string|null",
  "occurredAt": "timestamp",
  "clientOperationId": "uuid"
}
```

### Recognition result

```json
{
  "jobId": "uuid",
  "status": "PENDING|PROCESSING|PENDING_REVIEW|COMPLETED|FAILED",
  "candidates": [{
    "field": "name|barcode|brand|quantity|expiry",
    "value": "string",
    "confidence": 0.0,
    "evidence": "OCR|BARCODE|VISION|CATALOG_MATCH",
    "requiresReview": true
  }],
  "failure": {"code": "PROVIDER_TIMEOUT", "retryable": true}
}
```

## 4. API operations

| Operation | Metodo | Sincrono | Idempotenza | Autorizzazione |
|---|---|---|---|---|
| search products | GET | si | query cacheable | household/catalog read |
| create stock item | POST | si | Idempotency-Key | inventory write |
| record movement | POST | si | clientOperationId | inventory write |
| upload recognition | POST | no | Idempotency-Key | recognition write |
| read job | GET | si | n/a | job owner/household |
| get shopping list | GET | si | n/a | shopping read |
| complete shopping item | POST | si | Idempotency-Key | shopping write |
| recipe suggestions | GET/POST | no se AI | Idempotency-Key per job | recipe read |
| offers import | POST | no | source/window key | operator scope |
| export household | POST | no | Idempotency-Key | owner only |

## 4.1 Family and QR invite operations

| Operation | Metodo | Sincrono | Idempotenza | Autorizzazione |
|---|---|---|---|---|
| create family | POST `/api/v1/families` | si | Idempotency-Key | authenticated |
| create invite | POST `/api/v1/families/{familyId}/invites` | si | Idempotency-Key | creator/admin |
| resolve invite | POST `/api/v1/family-invites/resolve` | si | client nonce | public rate-limited |
| review invite | GET `/api/v1/family-invites/{attemptId}/review` | si | n/a | attempt owner |
| accept invite | POST `/api/v1/family-invites/{attemptId}/accept` | si | Idempotency-Key | authenticated attempt owner |
| reject invite | POST `/api/v1/family-invites/{attemptId}/reject` | si | Idempotency-Key | authenticated attempt owner |
| revoke invite | POST `/api/v1/families/{familyId}/invites/{inviteId}/revoke` | si | Idempotency-Key | creator/admin |
| change family | POST `/api/v1/families/{familyId}/activate` | si | n/a | active membership |

`resolve` non deve rivelare family name, membership o validita dettagliata per token invalidi. L'accettazione e atomica e idempotente.

## 5. Event envelope

```json
{
  "eventId": "uuid",
  "eventType": "inventory.stock.consumed",
  "eventVersion": 1,
  "occurredAt": "timestamp",
  "publishedAt": "timestamp|null",
  "aggregateType": "stock_item",
  "aggregateId": "uuid",
  "householdId": "uuid",
  "actorType": "USER|SERVICE|SYSTEM",
  "actorId": "uuid|null",
  "traceId": "hex",
  "schemaRef": "catalog://events/inventory.stock.consumed/v1",
  "payload": {}
}
```

`householdId` non e opzionale per eventi dati household. Eventi pubblici non contengono segreti, immagini o PII non necessarie.

## 6. Eventi canonici

### `inventory.stock.received.v1`

**Producer**: inventory service. **Consumer**: worker-core, search-indexer, nutrition.

Payload: `stockItemId`, `productId`, `quantity`, `unit`, `lotId`, `expiresAt`, `occurredAt`.

### `inventory.stock.consumed.v1`

**Producer**: inventory service. **Consumer**: worker-core, nutrition, analytics.

Payload: `stockItemId`, `productId`, `quantity`, `unit`, `consumptionSource`, `confidence`.

### `inventory.reorder-point-reached.v1`

**Producer**: worker-core. **Consumer**: shopping service, notification service.

Payload: `productId`, `stockItemId`, `availableQuantity`, `reorderPoint`, `reason`, `dedupeKey`.

### `recognition.completed.v1`

**Producer**: recognition service. **Consumer**: catalog review workflow, notification service.

Payload: `jobId`, `assetId`, `candidates`, `confidenceSummary`, `reviewRequired`.

### `catalog.product-updated.v1`

**Producer**: catalog service. **Consumer**: search-indexer, nutrition, recipes.

Payload: `productId`, `changedFields`, `source`, `provenanceVersion`.

### `offer.imported.v1`

**Producer**: offers service. **Consumer**: shopping suggestions, analytics.

Payload: `offerId`, `productId`, `retailerId`, `validFrom`, `validTo`, `area`, `sourceQuality`.

### `recipe.suggestion-generated.v1`

**Producer**: recipe service. **Consumer**: notification/history.

Payload: `suggestionId`, `recipeId`, `scoreBreakdown`, `availableIngredients`, `missingIngredients`, `quality`.

### `family.created.v1`

**Producer**: family service. **Consumer**: audit, notifications, analytics aggregate.

Payload: `familyId`, `creatorMembershipId`, `locale`, `timezone`.

### `family.invite.created.v1`

**Producer**: family service. **Consumer**: audit, telemetry.

Payload: `inviteId`, `familyId`, `role`, `expiresAt`, `createdBy`; mai token raw o fallback code.

### `family.invite.scanned.v1`

**Producer**: family service. **Consumer**: audit, security analytics.

Payload: `inviteId`, `joinAttemptId`, `outcome`, `scannedAt`; token non incluso.

### `family.invite.accepted.v1`

**Producer**: family service. **Consumer**: audit, notifications, analytics aggregate.

Payload: `inviteId`, `familyId`, `membershipId`, `role`, `acceptedAt`.

### `family.member.role-changed.v1`

**Producer**: family service. **Consumer**: authorization cache, audit, notifications.

Payload: `familyId`, `membershipId`, `previousRole`, `newRole`, `changedBy`.

## 7. Job state machine

```text
PENDING -> PROCESSING -> COMPLETED
                    \-> PENDING_REVIEW -> COMPLETED
                    \-> RETRY_WAIT -> PROCESSING
                    \-> FAILED -> DLQ/REPLAY
PENDING -> CANCELLED
```

Transizioni non valide sono rifiutate. Il risultato include tentativi, `startedAt`, `finishedAt`, `lastErrorCode` e `traceId`.

## 8. Versioning, replay e compatibilita

- schema registry versiona OpenAPI e JSON Schema;
- consumer contract testano esempi reali e campi ignoti;
- producer mantiene compatibilita per almeno una versione precedente;
- replay usa una nuova execution id ma conserva l'evento originale;
- trasformazioni distruttive richiedono migration plan e rollback;
- eventi personali soggetti a cancellazione devono supportare tombstone/erasure event e propagazione alle proiezioni.
