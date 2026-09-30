# Architecture v2

## Goal

The backend is a set of independently deployable bounded-context services. The web UI remains under `services/web` and is not rewritten by this reset.

## Request path

`Browser -> NGINX :8443 -> API Gateway :3000 -> domain service`.

The browser never reaches domain services or databases directly.

## Services

- identity: token/session integration with Keycloak
- users: application profile and preferences
- families: families, memberships, roles and invitations
- products: canonical application product model
- barcode: barcode normalization and resolution
- vision: image/OCR/barcode/product recognition orchestration
- inventory: current pantry state and inventory events
- expiration: explicit and estimated expiration logic
- shopping: shopping lists and restock workflows
- stores: stores and locations
- offers: prices, promotions and offers
- recipes: recipes and pantry matching
- nutrition: nutrition/allergen projections
- notifications: in-app/email/push notification state
- media: object metadata and MinIO integration
- search: OpenSearch projection
- analytics: event-derived statistics

## Workers

Workers are asynchronous consumers/producers. They must not own business data that belongs to a domain service.

## Independence rule

Each service has its own Dockerfile, package manifest, TypeScript project, tests and migration set. Shared packages may contain contracts/telemetry only; business logic and repositories are never shared across domains.
