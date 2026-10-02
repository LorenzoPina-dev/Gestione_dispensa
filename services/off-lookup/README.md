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


## Resilient cache refresh

Cached documents created by older versions are treated as not yet enriched. On the first lookup after the
new enrichment contract is introduced, OFF-Lookup attempts one live API refresh and fills only fields
that are missing in the cached document. Existing cached values are never overwritten.

- API success: the merged document is returned immediately and persisted.
- API timeout/network/rate-limit/5xx: the previous cached document is returned unchanged.
- API 404: the previous cached document is still returned; a later retry is allowed after the cooldown.
- Repeated refresh attempts are suppressed for `OFF_LOOKUP_API_REFRESH_COOLDOWN_MS` (default 10 minutes).
- Concurrent refreshes for the same barcode are coalesced inside one service instance.

The cache metadata is private and includes the enrichment/schema versions and refresh timestamps. A
successful refresh marks the current enrichment contract as applied even when OFF legitimately lacks
some optional fields, so sparse products do not trigger an API call on every lookup.

## Resetting only the live API cache

The Mongo collection also contains the optional official dump. Do **not** use `docker compose down -v`
when you only want to reset live API cache entries, because that removes the persisted Mongo volume.

Inspect the number of live-cached documents:

```powershell
docker compose exec mongodb mongosh --quiet off_lookup_db --eval 'db.products.countDocuments({"_cache_meta.origin":"live-api"})'
```

Delete only those live API documents:

```powershell
docker compose exec mongodb mongosh --quiet off_lookup_db --eval 'db.products.deleteMany({"_cache_meta.origin":"live-api"})'
```

Documents originating from the official dump are left intact. If a dump document is enriched from the
live API, its original `bulk-import` provenance is retained, so the reset command does not delete it.
