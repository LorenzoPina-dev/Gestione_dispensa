# API

Il browser usa esclusivamente `https://<host>:8443/api/v1/*`. Nginx inoltra a Gateway :3300.

| Area | Owner |
|---|---|
| /auth, /me | Identity |
| /families, /invites | Family |
| /inventory | Inventory |
| /shopping | Shopping |
| /products, /catalog | Catalog |
| /notifications | Notifications |
| /privacy | Privacy |
| /jobs | Jobs |
| /recipes | Recipes |
| /nutrition | Nutrition |
| /stores | Stores |
| /shelf-life | Shelf-Life |
| /ocr, /ocr-jobs | OCR |
| /views | Gateway |

Il dettaglio completo è in `openapi.yaml`.

## Envelope
```json
{"data":{},"meta":{"requestId":"uuid","traceId":"id"}}
```

Gli errori usano codici stabili; il client non deve dipendere dal testo umano.

## Auth e retry
Il client invia bearer JWT a Gateway; il servizio owner applica authorization.
Le mutazioni retryable usano `X-Idempotency-Key`; modifiche concorrenti possono richiedere `If-Match`.
`X-Request-Id` e `traceparent` sono propagati tra Nginx, Gateway e servizi.

## Composite Views
Una richiesta per schermata quando servono più domini. Gateway aggrega dati proprietari senza introdurre business logic.

## Contratto
`openapi.yaml` è il riferimento machine-readable. Evitare contratti descrittivi duplicati.
