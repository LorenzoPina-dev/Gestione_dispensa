# Event architecture

## Event envelope

Ogni evento deve avere:

`eventId`, `eventType`, `schemaVersion`, `occurredAt`, `producer`, `aggregateId`, `familyId` quando applicabile, `correlationId`, `causationId`, `payload`.

Gli schema sono versionati e compatibili in modo esplicito.

## Outbox

Una mutazione del service owner e il relativo record outbox vengono scritti nella **stessa transazione del database del service owner**.

```
service DB transaction
  ├── domain mutation
  └── outbox row
          |
          v
     publisher
          |
          v
      broker/Redis
          |
          v
      consumer
          |
          v
consumer's own DB transaction
```

Nessuna transazione distribuita tra database.

## Idempotenza

Il consumer deduplica tramite `eventId` o chiave equivalente. L'ack avviene solo dopo il commit locale.

Retry con backoff e limite. Dopo il limite il messaggio passa in DLQ e il job/evento resta osservabile.

## Eventi principali

| Evento | Owner | Utilizzatori |
|---|---|---|
| ProductCreated / ProductEnriched | Catalog | Inventory, Recipes |
| PantryItemAdded | Inventory | Shopping, Notifications |
| PantryItemConsumed | Inventory | Nutrition, Recipes |
| PantryItemWasted | Inventory | Nutrition, analytics |
| PantryLowStock | Inventory | Shopping, Notifications |
| ExpirationEstimated | Shelf-Life | Inventory, Notifications |
| OcrDraftReady | OCR | Gateway/UI workflow |
| FamilyInviteCreated | Family | Notifications |
| FamilyMemberAdded | Family | Notifications/projections |
| OfferUpdated | Stores | Shopping |
| JobFailed | Jobs/worker | Notifications/operations |

Gli eventi notificano cambiamenti; non sono chiamate RPC nascoste.
