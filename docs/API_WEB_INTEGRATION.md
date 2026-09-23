# API ↔ Web integration

The web application now consumes the API for domain data and no longer imports the prototype `mockData` dataset.

## Implemented web-facing API surface

- Auth: `GET /api/v1/auth/me`, `POST /api/v1/auth/register`, `POST /api/v1/auth/reset-password`, `POST /api/v1/auth/logout`.
- Families: create/list/read families, members, role/status changes, removal, invites, invite resolution and acceptance.
- Inventory: list/create/read stock items, record movements with `If-Match`, movement history, product/brand/category/nutrition/lot/location read model.
- Catalog: product list/read/create and barcode resolution.
- Shopping: active list, create list, add item, item state changes and batch actions.
- Recipes: list, suggestions, detail, add missing ingredients and cook/consume.
- Nutrition: today/week summaries with consumption rows and nutrient totals.
- Notifications: list and mark-read.
- Privacy: erasure, consent, export and download routes remain available.

## Important persistence changes

Migration `0012_web-read-model.sql` adds user profile fields and catalog metadata used by the web read model.

Inventory creation now accepts optional `location` and `expiresAt`, persists locations/lots, and movement recording updates lot quantities so the UI does not display stale batches after consumption/waste.

## Removed prototype behavior

- No bundled `mockData.ts` import remains in `apps/web/src`.
- Login no longer accepts local demo accounts.
- Onboarding no longer accepts hard-coded invitation codes or fabricates family IDs.
- Barcode lookup uses the catalog API instead of a hard-coded barcode map.
- Photo mode no longer fabricates Vision-AI candidates; it explicitly falls back to manual entry until a real image-recognition service is connected.
- Notifications, recipes and nutrition are loaded from API endpoints.
