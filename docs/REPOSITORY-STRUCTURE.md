# Repository structure

## Application deployables

| Path | Responsibility | Release stage |
|---|---|---|
| `apps/web` | Next.js PWA and family workflows | family-local |
| `apps/api` | synchronous API and transactional use cases | family-local |
| `services/gateway` | ingress, auth context, limits, routing | family-local |
| `services/worker-core` | inventory, reorder, shopping, reconciliation | family-local |
| `services/worker-integrations` | barcode, OCR, recipes, nutrition, offers | optional |
| `services/worker-notifications` | opt-in notification delivery | optional |
| `services/scheduler` | scheduled maintenance and imports | family-local |
| `services/search-indexer` | rebuildable search projection | optional |

## Shared packages

- `packages/contracts`: OpenAPI, JSON Schema events, jobs, generated types;
- `packages/config`: typed profile and secret-reference configuration;
- `packages/domain`: framework-independent primitives only;
- `packages/observability`: propagation, redaction, metrics, logs, and traces;
- `packages/testkit`: synthetic fixtures and integration harnesses;
- `packages/ui`: accessible UI primitives.

## Infrastructure

- `infra/compose`: local profiles and resource-aware startup;
- `infra/kubernetes`: portable base and environment overlays;
- `infra/postgres`: migrations, bootstrap, and synthetic seeds;
- `infra/identity`: Keycloak realm and client policy;
- `infra/storage`: MinIO buckets and lifecycle;
- `infra/observability`: dashboards, rules, collectors, logs, and traces.

This layout defines boundaries and ownership. Empty source folders are intentional until the
corresponding contract and implementation milestone is approved.