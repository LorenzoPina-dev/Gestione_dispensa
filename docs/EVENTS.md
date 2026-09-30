# Eventi

## Envelope
Ogni evento contiene eventId, eventType versionato, occurredAt, producer, aggregateId, familyId quando applicabile, correlationId, causationId, schemaVersion e payload.

## Outbox
La mutazione e il record outbox vengono salvati nella stessa transazione del DB owner. Un publisher inoltra l'evento. I consumer sono idempotenti per eventId e fanno ack solo dopo il commit locale.

Retry con backoff e limite; poi DLQ.

## Eventi principali
- ProductCreated/Enriched -> Catalog
- PantryItemAdded/Consumed/Wasted/LowStock -> Inventory
- ExpirationEstimated -> Shelf-Life
- OcrDraftReady -> OCR
- FamilyInviteCreated/MemberAdded -> Family
- OfferUpdated -> Stores
- JobFailed -> Jobs/worker

Gli eventi descrivono cambiamenti di stato; non sono RPC mascherate.
