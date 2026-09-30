# Database architecture

PostgreSQL is the transactional platform. The initial local deployment uses one PostgreSQL server with separate logical databases so services remain ownership-isolated without requiring many containers.

- `users_db`
- `families_db`
- `products_db`
- `barcode_db`
- `inventory_db`
- `expiration_db`
- `shopping_db`
- `stores_db`
- `offers_db`
- `recipes_db`
- `nutrition_db`
- `notifications_db`
- `media_db`
- `analytics_db`

MongoDB `off_catalog` is reserved for the Open Food Facts dump/cache. It is not the pantry database.

Redis is cache/lock/short-lived state only.

MinIO stores product images, user images, receipts and future ML datasets.

OpenSearch stores derived search indexes and can always be rebuilt from source services.

Kafka stores transient/replayable domain events, not authoritative current state.

## Migration rule

Every service owns and runs its own migrations. No service runs another service's migrations.
