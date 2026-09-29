# Component specifications

## Edge

### Nginx
- TLS termination;
- `/` → web;
- `/api/v1/*` → gateway;
- `/realms/*` → Keycloak;
- no direct browser route to internal services.

### Gateway
- JWT verification;
- routing;
- request metadata propagation;
- timeout/error normalization;
- Composite Views;
- no domain persistence.

## Domain services

Each domain service contains its HTTP boundary, application logic and persistence adapter. A service must be deployable and testable independently from sibling services.

## Workers

Workers are process boundaries for long-running operations. A worker must:

1. receive a versioned job/event;
2. validate it;
3. execute a bounded handler;
4. commit durable effects;
5. ack only after commit;
6. classify retryable/permanent failures;
7. publish audit/telemetry metadata.

## Data components

- PostgreSQL: transactional state;
- Redis: delivery/ephemeral coordination;
- MongoDB: OFF cache;
- MinIO: binary objects.

## Observability

Every HTTP request and asynchronous job carries correlation/trace metadata. Logs are structured and redacted. Metrics expose latency, error rate, queue depth, retries and readiness.
