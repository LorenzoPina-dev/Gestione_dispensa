# Service Architecture

## Ownership

| Service | Ownership | Storage | Public through Gateway |
|---|---|---|---|
| `service-identity` | OIDC profile, registration | `public` | yes |
| `service-family` | family, membership, invites | `public` | yes |
| `service-inventory` | stock, lots, movements | `public` | yes |
| `service-shopping` | lists and shopping items | `public` | yes |
| `service-catalog` | products, barcode candidates | `public` | yes |
| `service-notifications` | notifications | `public` | yes |
| `service-privacy` | consent, export, erasure | `public` | yes |
| `service-jobs` | job administration | `public` | operator only |
| `service-recipes` | recipes and suggestions | `recipes_domain` | yes |
| `service-nutrition` | nutrition diary and targets | `nutrition_domain` | yes |
| `service-stores` | stores and prices | `stores_domain` | yes |
| `service-shelf-life` | shelf-life rules/predictions | `shelf_life_domain` | yes |
| `service-ocr` | OCR jobs and drafts | `ocr_domain` | yes |
| `off-lookup` | OpenFoodFacts read-through cache | MongoDB | internal |

## Rules

1. No service imports another service's TypeScript source.
2. Cross-service writes happen through HTTP or the event/job layer.
3. The Gateway owns aggregation, routing and browser-facing authentication.
4. Domain services own domain validation and persistence.
5. Workers own asynchronous processing; HTTP services do not execute long-running jobs inline.
6. PostgreSQL remains the authoritative transactional store; MongoDB is a catalog cache, not the pantry source of truth.
7. `services/web` is a deployable UI service and is exposed only through Nginx.

## Request flow

```text
Browser
  │
  ▼
Nginx :8443
  │
  ▼
Gateway :3300
  │
  ├── Composite View ── parallel service reads
  └── Domain mutation ── one owning service
```
