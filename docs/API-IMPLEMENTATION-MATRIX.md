# API implementation matrix

La matrice usa solo i contratti canonici correnti. Le route di compatibilità eventualmente presenti nel codice non sono considerate parte del nuovo contratto pubblico.

| Domain | Canonical surface | Owner |
|---|---|---|
| Identity | `/me`, `/meta`, `/auth/*` | service-identity |
| Family | `/families/*`, `/family-invites/*`, `/invites/*` | service-family |
| Inventory | `/inventory/*` | service-inventory |
| Shopping | `/shopping-lists/*`, `/shopping/*` | service-shopping |
| Catalog | `/products/*`, `/catalog/*` | service-catalog |
| Notifications | `/notifications/*` | service-notifications |
| Privacy | `/privacy/*` | service-privacy |
| Jobs | `/jobs/*` | service-jobs |
| Recipes | `/recipes/*` | service-recipes |
| Nutrition | `/nutrition/*` | service-nutrition |
| Stores | `/stores/*` | service-stores |
| Shelf-Life | `/shelf-life/*` | service-shelf-life |
| OCR | `/ocr-jobs/*`, `/ocr/*` | service-ocr |
| Composite Views | `/views/*` | gateway |

## Required cross-cutting headers

| Header | Use |
|---|---|
| `Authorization` | JWT bearer |
| `If-Match` | optimistic concurrency |
| `X-Idempotency-Key` | retry-safe mutation |
| `traceparent` | distributed trace |
| `X-Request-Id` | request correlation |

## Error envelope

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "The resource changed after it was read.",
    "retryable": false
  },
  "meta": {
    "requestId": "..."
  }
}
```
