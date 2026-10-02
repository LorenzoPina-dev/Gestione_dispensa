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
