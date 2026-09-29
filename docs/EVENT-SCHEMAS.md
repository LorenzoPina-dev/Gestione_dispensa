# Events and queues

Gli eventi sono contratti di integrazione, non chiamate RPC nascoste. Ogni messaggio contiene almeno `eventId`, `eventType`, `schemaVersion`, `occurredAt`, `familyId` quando applicabile, `actorId` quando disponibile, `traceId` e `payload`.

## Canonical domain events

| Event | Producer | Consumers |
|---|---|---|
| `FAMILY_CREATED` | Family | Notifications, audit |
| `MEMBERSHIP_CHANGED` | Family | Gateway clients, Notifications |
| `STOCK_CHANGED` | Inventory | Shopping, Notifications, search-indexer |
| `STOCK_DEPLETED` | Inventory | Shopping, Notifications |
| `STOCK_EXPIRING` | Shelf-Life/Inventory | Notifications, Shopping |
| `SHOPPING_ITEM_CHANGED` | Shopping | UI sync, search-indexer |
| `RECIPE_COOKED` | Recipes | Inventory, Nutrition, audit |
| `NUTRITION_UPDATED` | Nutrition | UI/read models |
| `PRICE_RECORDED` | Stores/OCR | price intelligence, search |
| `OCR_READY_FOR_REVIEW` | OCR worker | Notifications, UI |
| `OCR_CONFIRMED` | OCR | Inventory, Stores, audit |
| `PRODUCT_ENRICHMENT_READY` | OFF worker | Catalog |
| `NOTIFICATION_CREATED` | Notification domain | Push/email/in-app worker |

## Queues

```text
q:ocr-processing
q:shelf-life-prediction
q:off-enrichment
```

Altri job possono usare il durable job subsystem con Redis come delivery transport. PostgreSQL rimane la source of truth per stato, tentativi, inbox/outbox e DLQ metadata.

## Delivery guarantees

- consumer idempotente;
- ack solo dopo commit dell'effetto durevole;
- retry bounded per errori transient;
- DLQ per errori permanenti o exhausted retries;
- `traceId` propagato end-to-end;
- payload versionato.

## Outbox

Quando una modifica di dominio deve generare un evento affidabile, il record di outbox viene scritto nella stessa transazione della modifica di stato. Un publisher successivo consegna il messaggio alla coda e marca l'outbox come pubblicato.
