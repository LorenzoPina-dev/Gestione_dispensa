# JSON Schema eventi e job

## 1. Registry policy

- namespace: `dispensa.events`;
- naming: `{bounded-context}.{aggregate}.{past-tense}.v{major}`;
- schema format: JSON Schema 2020-12;
- compatibility: backward compatible within major; breaking changes require new major;
- unknown fields: consumer MUST ignore unknown fields;
- required fields: never remove during active compatibility window;
- PII: ogni field e classificato `public`, `operational`, `personal` o `sensitive`;
- replay: conserva `eventId` originale e genera `executionId` nuovo;
- payload raw di provider e token non entrano negli eventi canonici.

## 2. Envelope canonico

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.example.invalid/dispensa/event-envelope/v1.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["eventId", "eventType", "eventVersion", "occurredAt", "aggregateType", "aggregateId", "actorType", "traceId", "payload"],
  "properties": {
    "eventId": {"type": "string", "format": "uuid"},
    "eventType": {"type": "string", "pattern": "^[a-z]+\\.[a-z-]+\\.[a-z-]+\\.v[0-9]+$"},
    "eventVersion": {"type": "integer", "minimum": 1},
    "occurredAt": {"type": "string", "format": "date-time"},
    "publishedAt": {"type": ["string", "null"], "format": "date-time"},
    "aggregateType": {"type": "string"},
    "aggregateId": {"type": "string", "format": "uuid"},
    "familyId": {"type": ["string", "null"], "format": "uuid"},
    "actorType": {"type": "string", "enum": ["USER", "SERVICE", "SYSTEM"]},
    "actorId": {"type": ["string", "null"], "format": "uuid"},
    "traceId": {"type": "string", "minLength": 16},
    "schemaRef": {"type": "string"},
    "payload": {"type": "object"}
  }
}
```

## 3. Family events

### `family.created.v1`

```json
{
  "eventType": "family.created.v1",
  "aggregateType": "family",
  "payload": {
    "familyId": "uuid",
    "creatorMembershipId": "uuid",
    "locale": "it-IT",
    "timezone": "Europe/Rome",
    "unitSystem": "METRIC"
  }
}
```

Required payload: `familyId`, `creatorMembershipId`, `locale`, `timezone`, `unitSystem`. PII: operational.

### `family.invite.created.v1`

Required payload: `inviteId`, `familyId`, `role`, `expiresAt`, `createdBy`. Never include raw QR token or fallback code.

### `family.invite.scanned.v1`

Required payload: `inviteId`, `joinAttemptId`, `outcome`, `scannedAt`. `outcome` enum: `VALID`, `INVALID`, `EXPIRED`, `REVOKED`, `USED`, `RATE_LIMITED`.

### `family.invite.accepted.v1`

Required payload: `inviteId`, `familyId`, `membershipId`, `role`, `acceptedAt`. Consumer must deduplicate by `eventId`.

### `family.member.role-changed.v1`

Required payload: `familyId`, `membershipId`, `previousRole`, `newRole`, `changedBy`, `changedAt`.

## 4. Inventory events

### `inventory.stock.received.v1`

Required payload: `stockItemId`, `productId`, `quantity`, `unit`, `occurredAt`, `movementId`.

### `inventory.stock.consumed.v1`

Required payload: `stockItemId`, `productId`, `quantity`, `unit`, `movementId`, `consumptionSource`, `confidence`.

`confidence` is required only when `consumptionSource` is estimated; confirmed user actions use `1.0` only if the semantic meaning is explicitly documented.

### `inventory.reorder-point-reached.v1`

Required payload: `familyId`, `productId`, `stockItemId`, `availableQuantity`, `reorderPoint`, `dedupeKey`, `reasonCode`.

## 5. Catalog, offer and recipe events

### `catalog.product-updated.v1`

Required payload: `productId`, `changedFields`, `sourceId`, `provenanceVersion`, `updatedAt`.

### `offer.imported.v1`

Required payload: `offerId`, `retailerId`, `productId`, `validFrom`, `validTo`, `area`, `sourceQuality`.

### `recipe.suggestion-generated.v1`

Required payload: `suggestionId`, `familyId`, `recipeId`, `algorithmVersion`, `quality`, `availableIngredients`, `missingIngredients`, `reasonCodes`, `expiresAt`.

## 6. Job contract

### `job.created.v1`

Required payload: `jobId`, `capability`, `idempotencyKey`, `requestedAt`, `requestedBy`.

### `job.completed.v1`

Required payload: `jobId`, `capability`, `completedAt`, `resultRef`, `durationMs`, `attempt`.

### `job.failed.v1`

Required payload: `jobId`, `capability`, `failedAt`, `errorCode`, `retryable`, `attempt`, `dlqRef nullable`.

Job result payload should be referenced by ID when large or sensitive; it should not be copied into telemetry.

## 7. Outbox and inbox contract

### Outbox state

```text
PENDING -> PUBLISHED -> ACKNOWLEDGED
    |          |
    +-------> FAILED -> RETRY_WAIT -> PUBLISHED
```

Outbox publisher:

- locks a bounded batch;
- publishes with event id;
- marks published only after broker acknowledgement;
- retries transient errors;
- alerts on age threshold;
- never deletes before retention/reconciliation policy.

Consumer inbox:

- checks `(consumerName, eventId)` before side effect;
- processes inside transaction when possible;
- records success/failure and handler version;
- acknowledges only after commit;
- sends poison messages to DLQ after retry limit.

## 8. Schema review checklist

- event has owner and producer;
- every field has classification and meaning;
- family scope is explicit where required;
- no secret/token/raw image/unused PII;
- consumer compatibility tested;
- retry and idempotency defined;
- replay and erasure behavior defined;
- metrics and trace fields defined;
- example payload passes validator;
- versioning decision recorded in changelog/ADR.
