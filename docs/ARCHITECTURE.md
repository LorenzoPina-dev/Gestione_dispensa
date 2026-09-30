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

## Observability contract

Observability is a platform requirement, not an optional feature of individual services.

Every HTTP service must expose:

- `/health/live` for process liveness
- `/health/ready` for dependency readiness
- `/metrics` in Prometheus text format
- structured JSON logs to stdout/stderr
- `x-request-id` propagation
- W3C `traceparent` propagation
- request duration and status metrics
- outbound-call duration/error metrics
- database query duration/error metrics when the service owns a database
- uncaught exception/unhandled rejection logging

### Traceability

A request receives one request ID and one trace ID at the edge. The same trace context is propagated through gateway -> service -> downstream service -> database/worker boundary where technically applicable.

Grafana is the operational UI. Prometheus stores metrics, Loki stores container logs, Tempo stores distributed traces, and the OpenTelemetry Collector is the OTLP ingestion boundary.

The minimum investigation workflow is:

`requestId/traceId -> Gateway access log -> downstream service spans/logs -> outbound dependency -> database query -> response latency`.

Sensitive values such as bearer tokens, passwords and secrets must never be logged. Metric labels must remain bounded-cardinality; user IDs, barcodes, product names and request IDs are not metric labels.

A service is not considered production-ready until its business operations are instrumented at the same granularity as its HTTP boundary.
