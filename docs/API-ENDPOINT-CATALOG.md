# API endpoint catalog

All browser APIs are exposed under `https://<host>:8443/api/v1`. The Gateway is the public API boundary.

## Identity

```text
GET  /me
GET  /meta
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/password-reset
```

## Family

```text
GET    /families
POST   /families
GET    /families/:familyId
GET    /families/:familyId/members
PATCH  /families/:familyId/members/:membershipId
DELETE /families/:familyId/members/:membershipId
GET    /families/:familyId/invites
POST   /families/:familyId/invites
POST   /family-invites/resolve
POST   /family-invites/resolve-code
POST   /invites/:inviteId/accept
```

## Inventory

```text
GET    /inventory/locations
POST   /inventory/locations
PATCH  /inventory/locations/:id
DELETE /inventory/locations/:id
GET    /inventory/stock-items
GET    /inventory/stock-items/:id
POST   /inventory/stock-items
PATCH  /inventory/stock-items/:id
DELETE /inventory/stock-items/:id
POST   /inventory/stock-items/:id/consume
POST   /inventory/stock-items/:id/discard
POST   /inventory/stock-items/:id/restore
GET    /inventory/movements
```

Mutazioni concorrenti usano `If-Match` quando il resource contract richiede optimistic locking. Offline mutations devono fornire `X-Idempotency-Key`.

## Catalog

```text
GET  /products
GET  /products/:id
POST /products
PATCH /products/:id
GET  /products/:barcode/lookup
POST /products/resolve-barcode
```

La risoluzione barcode può usare prima la cache OFF locale e poi il fallback remoto secondo il contratto del Catalog service.

## Shopping

```text
GET    /shopping-lists
GET    /shopping-lists/active
POST   /shopping-lists
GET    /shopping-lists/:id/items
POST   /shopping-lists/:id/items
PATCH  /shopping-lists/:id/items/:itemId
DELETE /shopping-lists/:id/items/:itemId
POST   /shopping-lists/:id/items/:itemId/complete
POST   /shopping-lists/:id/items/batch
```

## Recipes

```text
GET    /recipes
GET    /recipes/:id
POST   /recipes
PUT    /recipes/:id
DELETE /recipes/:id
POST   /recipes/:id/photo
POST   /recipes/:id/cook
POST   /recipes/:id/missing-to-shopping
GET    /recipes/suggestions
```

## Nutrition

```text
GET /nutrition/today
GET /nutrition/history
POST /nutrition/log
GET /nutrition/targets
PUT /nutrition/targets
GET /nutrition/summary
```

## Stores and prices

```text
GET  /stores
POST /stores
GET  /stores/:storeId/products
POST /stores/:storeId/prices
GET  /stores/price-history
```

## Shelf-life

```text
GET  /shelf-life/predict
POST /shelf-life/predict
GET  /shelf-life/foodkeeper/categories
GET  /shelf-life/foodkeeper/items/:id
POST /shelf-life/custom-rule
```

## OCR

```text
POST /ocr-jobs
GET  /ocr-jobs
GET  /ocr-jobs/:id
GET  /ocr-jobs/:id/drafts
POST /ocr-jobs/:id/confirm
POST /ocr/barcode-extract
```

`POST /ocr-jobs` è asincrono e restituisce un job identifier. La conferma della revisione è un comando separato.

## Notifications, privacy and jobs

```text
GET  /notifications
POST /notifications/:id/read
GET  /privacy/consents
PUT  /privacy/consents
POST /privacy/export
POST /privacy/erasure
GET  /jobs
GET  /jobs/:id
POST /jobs/:id/retry
```

## Composite views

```text
GET /views/dashboard-today
GET /views/pantry-screen
GET /views/shopping-screen
GET /views/recipes-screen
GET /views/nutrition-screen
GET /views/family-screen
GET /views/notifications-screen
```

## Common headers

- `Authorization: Bearer <JWT>`
- `If-Match: <etag>` per optimistic concurrency
- `X-Idempotency-Key: <stable-key>` per retry-safe mutation
- `traceparent` per distributed tracing
- `X-Request-Id` per request correlation
