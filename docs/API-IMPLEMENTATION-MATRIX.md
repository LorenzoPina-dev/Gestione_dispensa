# API implementation matrix — v1

Questo documento descrive la convergenza tra UI, contratto API e implementazione server. Gli endpoint
canonici sono quelli di `docs/API-ENDPOINT-CATALOG.md`. Le vecchie route sono mantenute solo dove è
possibile migrare la UI senza rompere immediatamente i client esistenti.

## Convergenza implementata

| Area | Canonical surface | Stato | Note |
|---|---|---|---|
| Identity | `GET /me` | IMPLEMENTED | Alias legacy `/auth/me`; identità derivata dal bearer OIDC verificato. |
| Family | `/families/*` | PARTIAL | Lista famiglie, creazione, membri, inviti create/resolve/accept già presenti. |
| Family invites | `/family-invites/resolve*` | IMPLEMENTED | Alias canonical aggiunto; legacy `/invites/*` mantenuto per compatibilità. |
| Catalog | `/products` | PARTIAL | Creazione prodotto e barcode resolve disponibili; CRUD completo ancora da aggiungere. |
| Inventory | `/inventory/items*` | PARTIAL | Lista, creazione e movement disponibili; canonical alias aggiunto. |
| Shopping | `/shopping-lists*` | PARTIAL | Create, active, item add/update e batch disponibili; CRUD completo lista ancora da aggiungere. |
| Recipes | `/recipes/*` | PARTIAL | Suggestions, add-missing e cook disponibili; detail/plan/job ancora da aggiungere. |
| Nutrition | `/nutrition/summary` | IMPLEMENTED | Controller/service/repository ora vengono effettivamente collegati dal composition root. |
| Notifications | `/notifications*` | IMPLEMENTED | Controller/service/repository ora vengono effettivamente collegati dal composition root. |
| Privacy | `/privacy/*` | PARTIAL | Export, erasure e consent esistono; nomi canonical/pluralizzati allineati dove possibile. |
| Jobs | `/admin/jobs/*` | IMPLEMENTED | Inspect/replay presenti. |
| Platform | `/health/*`, `/api/v1/meta` | IMPLEMENTED | Readiness/liveness/meta presenti. |

## Modifiche di questa convergenza

1. `apps/api/src/server.ts` costruisce ora anche Notifications, Nutrition e Recipes con repository PostgreSQL reali.
2. `GET /api/v1/me` è disponibile; `/api/v1/auth/me` resta alias di compatibilità.
3. `/inventory/items` è canonical; `/inventory/stock-items` resta temporaneamente supportato.
4. `/products` e `POST /products/resolve-barcode` sono canonical; `/catalog/products` e `/catalog/lookup` restano legacy.
5. `/shopping-lists` e relative route item/batch sono canonical; `/shopping/lists*` resta legacy.
6. `/family-invites/resolve` e `/family-invites/resolve-code` sono canonical; le vecchie `/invites/*` restano compatibili.
7. `apps/web/src/api/config.ts` usa correttamente `http://localhost:3000/api/v1` come default.
8. `apps/web/src/api/endpoints.ts` è stato spostato sulle route canonical già supportate dal server.

## Gap ancora intenzionali

Non vengono creati endpoint che restituiscono dati fittizi. Restano da implementare realmente: family detail/activate, invite listing/revoke/review/reject, catalog CRUD/list/search, media/recognition, inventory detail/update/history/expiry/consumption, shopping list detail/complete/load/archive, recipe detail/plan/jobs, nutrition product detail, offers, notification preferences e admin audit.

Il criterio di completamento è: **route + controller + service/domain + repository + autorizzazione + family isolation + schema/DTO + test di contratto**, non la sola presenza della route.

## Phase 2 — convergence additions (2026-09-23)

Implemented against the real PostgreSQL repositories:

- `GET /api/v1/families/{familyId}` — family detail with membership authorization.
- `GET /api/v1/products` — active catalog listing.
- `GET /api/v1/products/{productId}` — product detail.
- `GET /api/v1/inventory/items/{stockItemId}` — family-scoped stock item detail.
- `GET /api/v1/inventory/items/{stockItemId}/movements` — family-scoped movement history.

The old compatibility aliases remain where they already existed; new canonical routes are the preferred frontend contract.

Build verification remains blocked in the provided environment because the dependency tree cannot be restored (`npm ci` timed out and the available TypeScript installation lacks required type packages). No build-pass claim is made until dependencies are restored.

## Phase 3 — family invites + shopping list convergence (2026-09-23)

Implemented as real domain operations backed by PostgreSQL:

- `GET /api/v1/families/{familyId}/invites` — admin-scoped invite listing; secret token/fallback hashes are never serialized.
- `POST /api/v1/families/{familyId}/invites/{inviteId}/revoke` — admin-scoped revocation with family isolation.
- `GET /api/v1/family-invites/{attemptId}/review` — authenticated join-attempt review, restricted to the attempt owner.
- `POST /api/v1/family-invites/{attemptId}/reject` — authenticated, audited rejection through the existing atomic repository operation.
- `GET /api/v1/shopping-lists/{listId}?familyId=...` — family-scoped active-list detail including items.
- `POST /api/v1/shopping-lists/{listId}/archive` — optimistic-concurrency archive using `If-Match`; stale versions produce `VERSION_CONFLICT`.

The shopping domain model now represents both `ACTIVE` and `ARCHIVED` list states and uses a numeric version instead of a literal `1`, so concurrency is represented correctly in the API contract.
