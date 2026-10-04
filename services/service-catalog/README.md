# Catalog

Products, barcode resolution and imported candidates.

- Container port: `3314`
- Data ownership: `public`
- Browser exposure: through `services/gateway` and `infra/nginx` only (except `web`, which is the root UI upstream).

## Boundary

This service owns its domain logic and persistence. Cross-service operations use HTTP or the existing Redis/job contracts; TypeScript source is never imported from another service.

## Barcode quantity contract

For Open Food Facts barcode resolution, Catalog maps package and serving data deterministically:

- `package.value` ← `product_quantity`
- `package.unit` ← `product_quantity_unit`
- `package.label` ← `quantity` (fallback: `product_quantity + product_quantity_unit`)
- `serving.quantity` ← `serving_quantity`
- `serving.unit` ← `serving_quantity_unit`
- `serving.size` ← `serving_size` (fallback: `serving_quantity + serving_quantity_unit`)

The complete upstream OFF document remains available through `openFoodFacts` and is persisted in `openfoodfacts_raw`.

## Barcode resolve response contract

`POST /api/v1/catalog/barcodes/resolve` never exposes the persisted Mongo representation as the UI contract. The response is mapped to `PublicProduct`.

For products previously stored with `images_json = null` but with the original OFF document in `openfoodfacts_raw`, Catalog reconstructs the deterministic OFF image URL fields before responding:

- `images.front/frontSmall/frontThumb`
- `images.ingredients/ingredientsSmall/ingredientsThumb`
- `images.nutrition/nutritionSmall/nutritionThumb`
- `images.packaging/packagingSmall/packagingThumb`

The same URLs are also materialized into the `openFoodFacts.image_*_url` fields so the UI never has to understand OFF image metadata (`imgid`, `rev`, `sizes`) or reconstruct image paths itself.

The original OFF data remains available in `openFoodFacts` for the product-details/debug view, but it is returned as an API-shaped/enriched view rather than as the raw Mongo cache document.
