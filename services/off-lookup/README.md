# OpenFoodFacts Lookup

MongoDB read-through cache with live OFF fallback.

- Container port: `3200`
- Data ownership: `mongodb`
- Browser exposure: through `services/gateway` and `infra/nginx` only (except `web`, which is the root UI upstream).

## Boundary

This service owns its domain logic and persistence. Cross-service operations use HTTP or the existing Redis/job contracts; TypeScript source is never imported from another service.


## Barcode response contract

```text
GET /api/v1/products/{barcode}
  -> 200 { code, source, product }

product is the original Open Food Facts document, with private cache metadata removed.
When the live v3 API is used, image URLs are requested explicitly so the response can expose
the selected front/ingredients/nutrition/packaging images. A 404 means Open Food Facts explicitly
does not contain the barcode; a 503 means lookup infrastructure is temporarily unavailable.
```

The service keeps the read-through Mongo cache optional: if Mongo is unavailable, the live Open
Food Facts v3 API remains the fallback. The Catalog service is responsible for persisting the
normalized product plus the complete provider payload for future reads.
