# Service catalog

## HTTP services

| Service | Port | Health | Main routes |
|---|---:|---|---|
| gateway | 3300 | `/health/live`, `/health/ready` | `/api/v1/views/*`, routed `/api/v1/*` |
| identity | 3310 | `/health/live`, `/health/ready` | `/auth/*`, `/me`, `/meta` |
| family | 3311 | `/health/live`, `/health/ready` | `/families/*`, `/family-invites/*`, `/invites/*` |
| inventory | 3312 | `/health/live`, `/health/ready` | `/inventory/*` |
| shopping | 3313 | `/health/live`, `/health/ready` | `/shopping-lists/*`, `/shopping/*` |
| catalog | 3314 | `/health/live`, `/health/ready` | `/products/*`, `/catalog/*` |
| notifications | 3315 | `/health/live`, `/health/ready` | `/notifications/*` |
| privacy | 3316 | `/health/live`, `/health/ready` | `/privacy/*` |
| jobs | 3317 | `/health/live`, `/health/ready` | `/jobs/*` |
| recipes | 3401 | `/health/live`, `/health/ready` | `/recipes/*` |
| nutrition | 3402 | `/health/live`, `/health/ready` | `/nutrition/*` |
| stores | 3403 | `/health/live`, `/health/ready` | `/stores/*` |
| shelf-life | 3404 | `/health/live`, `/health/ready` | `/shelf-life/*` |
| OCR | 3405 | `/health/live`, `/health/ready` | `/ocr-jobs/*`, `/ocr/*` |
| OFF Lookup | 3200 | `/health/live`, `/health/ready` | `/products/:barcode` |

## Workers

| Worker | Queue/input | Responsibility |
|---|---|---|
| worker-core | durable jobs / Redis delivery | inventory, restock, outbox and reconciliation jobs |
| worker-ocr | `q:ocr-processing` | OCR processing and draft generation |
| worker-shelf-life | `q:shelf-life-prediction` | prediction refinement and expiry processing |
| worker-off-sync | `q:off-enrichment` | OFF cache enrichment |
| worker-notifications | notification jobs | in-app/email/push dispatch according to consent |
| worker-integrations | provider adapters | external integration pipeline |
| scheduler | scheduled tasks | expiry, reconciliation, retention and maintenance |
| search-indexer | rebuildable projection | search projections; PostgreSQL remains authoritative |

## Internal dependencies

```text
Catalog ───────────────→ OFF Lookup
Inventory ─────────────→ Shelf-Life
Shopping ──────────────→ Inventory
Recipes ───────────────→ Inventory + Shopping
Nutrition ─────────────→ recipe/consumption data
OCR ───────────────────→ Inventory + Stores at confirmation boundary
Notifications ←──────── worker-notifications
```

## Shared packages

`packages/contracts`, `packages/config`, `packages/observability`, `packages/testkit` and `packages/ui` contain technical or wire-level reuse. They must not become a hidden shared domain implementation.
