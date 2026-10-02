# Architettura Microservices v2

## Modello
Ogni bounded context è un processo indipendente con codice, API, database, migration, credenziali, health/readiness, deploy e scaling propri.

**Database-per-service è obbligatorio.** La condivisione fisica dell'istanza PostgreSQL in locale è solo un dettaglio di deployment: i database applicativi restano separati e non esistono tabelle condivise.

```
Browser -> Nginx -> Gateway
                    |-> Identity
                    |-> Family
                    |-> Inventory
                    |-> Shopping
                    |-> Catalog
                    |-> Notifications
                    |-> Privacy
                    |-> Jobs
                    |-> Recipes
                    |-> Nutrition
                    |-> Stores
                    |-> Shelf-Life
                    |-> OCR

Async: service transaction -> local Outbox -> per-database outbox-relay -> Redis Stream -> consumer worker -> service-owned DB. Ogni relay riceve una sola DATABASE_URL; nessun relay accede al DB di un altro service.
Data: Catalog -> OFF Lookup -> OpenFoodFacts MongoDB
Blob: OCR/Vision/Shelf-Life -> MinIO
```

Gateway: routing, auth context, correlation, rate limiting, error normalization e Composite Views. Non possiede dati di dominio.

HTTP è usato per operazioni immediate; eventi/job per OCR, vision, shelf-life, enrichment, notifiche e indicizzazione. Redis Streams è transport, non source of truth: Outbox e DB di dominio restano autorevoli.

Le mutazioni locali sono transazionali. Gli eventi usano Outbox Pattern, consumer idempotenti, retry bounded e DLQ. Non si usano transazioni distribuite.
