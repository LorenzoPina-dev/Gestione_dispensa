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


## Local-first barcode resolution

The barcode path is intentionally **not** a completeness-gated cache lookup:

1. normalize the barcode as a string (spaces removed; leading zeroes preserved);
2. query MongoDB by the indexed `code` field;
3. if a document exists, run the OFF derivation layer first;
4. only if a configured required field is still missing after derivation may the live OFF API be called;
5. if the API is unavailable, the locally derived product remains usable;
6. successful remote enrichment is merged conservatively and cached without overwriting existing values.

`OFF_LOOKUP_MIN_COMPLETENESS` defaults to `0` and should remain `0` for barcode lookup. OFF's own completeness score is a product-quality metric, not evidence that a barcode is absent or unusable. A sparse but valid OFF document must therefore still be returned.

### Persisted vs derived image data

The adapter treats image metadata and image URLs as different things. Current OFF schema versions can store selections below `images.selected.<type>.<language>`, while older dumps can expose `selected_images`. The adapter supports both forms. It uses the selected image's `imgid`/revision and the product barcode path to reconstruct the OFF image-server filenames. The official Product Opener implementation documents the directory split and selected filename format. Open Food Facts Product Opener image implementation: https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Images.pm

The image bytes are never copied into the OFF MongoDB database by the lookup service. URLs are deterministic references to the OFF image server. This is consistent with the OFF server's own separation between persisted image metadata and generated image URLs.

### Automatic Mongo → API → HTTP image verification

The image round-trip integration test validates real dump data instead of synthetic fixtures:

1. reads products with front-image metadata directly from the configured Mongo dump;
2. derives the local `image_front_url` from the persisted metadata;
3. calls the live OFF v3 API with `generate_images_urls=1`;
4. compares the local image path/filename with the API-generated front-image URL;
5. verifies that both the locally reconstructed URL and the API URL are reachable over HTTP.

It is intentionally opt-in because it requires the real OFF dump and makes live HTTP requests:

```powershell
$env:OFF_LOOKUP_IMAGE_INTEGRATION="1"
$env:OFF_LOOKUP_IMAGE_TEST_LIMIT="10"
npm run test:integration:images --workspace @gestione-dispensa/off-lookup
```

The test fails if no derivable front images are found, if the local URL disagrees with the API path, or if either image URL is not reachable. It does not silently convert a missing/invalid image into a passing test.

### API fallback policy

`OFF_LOOKUP_REMOTE_ENRICHMENT=missing` is the recommended mode. Its default required field is `name`, because a product without any usable name cannot be presented safely. Additional fields can be declared with `OFF_LOOKUP_REQUIRED_LOCAL_FIELDS`, for example:

```text
name,image,ingredients,nutriments,quantity
```

Do **not** interpret every absent optional field as an API failure. OFF products are legitimately sparse. A remote call is justified only when the application explicitly requires a field that cannot be obtained from persisted data or deterministic derivation.

### Important schema-version detail

Open Food Facts changed the image structure in product schema 1002/API 3.3: uploaded and selected images are separated under the `images` structure. The adapter therefore supports both the newer nested structure and legacy `selected_images` documents instead of assuming one dump schema.
