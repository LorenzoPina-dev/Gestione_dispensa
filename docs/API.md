# API

Browser -> Nginx -> Gateway. Il Gateway non contiene business logic di dominio.

Header standard: Authorization, X-Request-Id, X-Correlation-Id, X-Idempotency-Key e If-Match.

Route ownership:
- /api/families -> Family
- /api/inventory -> Inventory
- /api/shopping -> Shopping
- /api/catalog -> Catalog
- /api/recipes -> Recipes
- /api/nutrition -> Nutrition
- /api/stores -> Stores
- /api/notifications -> Notifications
- /api/privacy -> Privacy
- /api/ocr -> OCR
- /api/shelf-life -> Shelf-Life

Composite Views sono GET aggregate ottenute chiamando i service owner in parallelo. Timeout/partial failure devono essere espliciti. Le mutation non vengono duplicate nel Gateway.
