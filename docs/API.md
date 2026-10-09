# API

Il browser usa `https://<host>:8443/api/v1/*`; NGINX inoltra le richieste al Gateway interno `:3300`. Le porte dei servizi non sono ingressi browser. L'elenco delle capacità e i diagrammi sono in [DIAGRAMS.md](DIAGRAMS.md#mappa-delle-funzioni-http).

| Area | Owner |
|---|---|
| `/auth`, `/me`, preferenze dietetiche | Identity |
| `/families`, `/invites` | Family |
| `/inventory` | Inventory |
| `/shopping` | Shopping |
| `/products`, `/catalog`, barcode | Catalog |
| risoluzione semantica interna | Food Semantics |
| `/notifications` | Notifications |
| `/privacy` | Privacy |
| `/jobs` | Jobs |
| `/recipes` | Recipes |
| `/nutrition` | Nutrition |
| `/stores` | Stores |
| `/shelf-life` | Shelf-Life |
| `/ocr`, `/ocr-jobs` | OCR |
| `/views` | Gateway |

Il dettaglio di path, metodi, parametri e schemi esposti dal Gateway è in [openapi.yaml](openapi.yaml). Le API interne di Food Semantics, off-lookup, search-indexer e Jobs non sono route browser pubbliche.

## Envelope

Le risposte seguono l'envelope del servizio/API; i metadati includono request/trace id dove previsto. Gli errori usano codici stabili: il client non deve dipendere dal testo descrittivo.

## Auth e retry

Il client invia un bearer JWT; Gateway verifica issuer, audience e firma. Il servizio owner autorizza la risorsa e l'ambito familiare. `X-Idempotency-Key`, `If-Match`, `X-Request-Id` e `traceparent` si applicano secondo i contratti delle singole operazioni, non come requisito uniforme dedotto per ogni route.

## Composite Views

Gateway può aggregare letture per semplificare la UI. Le mutazioni e le invarianti restano nel servizio che possiede i dati.
