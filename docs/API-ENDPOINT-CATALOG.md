# Catalogo endpoint e use case API

Questo catalogo completa il contratto OpenAPI baseline. Ogni endpoint deve essere materializzato nello schema OpenAPI prima del rilascio; i nomi e gli scope sono normativi.

## Convenzioni

- base `/api/v1`;
- response envelope `data/meta` e error envelope stabile;
- `familyId` dal contesto attivo o path esplicito;
- `Idempotency-Key` su mutazioni ripetibili;
- `If-Match` su risorse concorrenti;
- `202 + jobId` per lavori lunghi;
- `404 NOT_FOUND_OR_NOT_VISIBLE` per evitare enumeration.

## Identity/family

| Metodo/path | Use case | Scope |
|---|---|---|
| `GET /me` | principal, famiglie, consensi sintetici | authenticated |
| `GET /families` | famiglie dell'utente | authenticated |
| `POST /families` | crea famiglia e membership creator | authenticated |
| `GET /families/{familyId}` | dettaglio famiglia | family.read |
| `POST /families/{familyId}/activate` | cambia contesto attivo | membership |
| `GET /families/{familyId}/members` | membri visibili | family.read |
| `PATCH /families/{familyId}/members/{membershipId}` | ruolo/stato | family.admin |
| `DELETE /families/{familyId}/members/{membershipId}` | rimuovi membro | family.admin |
| `POST /families/{familyId}/invites` | crea QR invite | family.admin |
| `GET /families/{familyId}/invites` | stati inviti senza token | family.admin |
| `POST /families/{familyId}/invites/{inviteId}/revoke` | revoca invite | family.admin |
| `POST /family-invites/resolve` | risolve QR/fallback rate-limited | public limited |
| `GET /family-invites/{attemptId}/review` | preview limitata | join owner |
| `POST /family-invites/{attemptId}/accept` | membership atomica | join owner |
| `POST /family-invites/{attemptId}/reject` | rifiuto auditato | join owner |

## Catalog/product

| Metodo/path | Use case | Scope |
|---|---|---|
| `GET /products` | ricerca/filtro catalogo | family.read |
| `POST /products` | crea prodotto manuale | family.write/catalog |
| `GET /products/{productId}` | dettaglio provenance/nutrizione | family.read |
| `PATCH /products/{productId}` | correzione confermata | family.write/catalog |
| `POST /products/resolve-barcode` | lookup sincrono/cache | family.read |
| `POST /catalog/import` | import provider asincrono | operator |
| `GET /catalog/conflicts` | review conflitti | catalog |
| `POST /catalog/conflicts/{id}/resolve` | accetta/reject merge | catalog |

## Recognition/media

| Metodo/path | Use case | Scope |
|---|---|---|
| `POST /media/upload-intent` | URL prefirmato | family.write |
| `POST /recognition/jobs` | crea OCR/vision job | recognition.write |
| `GET /recognition/jobs/{jobId}` | stato/candidati | family/job |
| `POST /recognition/jobs/{jobId}/confirm` | conferma candidati | family.write |
| `POST /recognition/jobs/{jobId}/cancel` | cancella job | job owner |

## Inventory/consumption

| Metodo/path | Use case | Scope |
|---|---|---|
| `GET /inventory` | lista con filtri/cursor | inventory.read |
| `POST /inventory/items` | crea stock | inventory.write |
| `GET /inventory/items/{stockItemId}` | dettaglio lotto/movimenti | inventory.read |
| `PATCH /inventory/items/{stockItemId}` | soglia/posizione/metadati | inventory.write |
| `POST /inventory/items/{stockItemId}/movements` | receipt/consume/waste/adjust | inventory.write |
| `GET /inventory/items/{stockItemId}/movements` | storico | inventory.read |
| `POST /consumption/estimate` | stima da ricetta/diario | nutrition/consumption |
| `POST /consumption/{id}/correct` | corregge stima | inventory.write |
| `GET /expiry` | scaduti/in scadenza | inventory.read |

## Shopping

| Metodo/path | Use case | Scope |
|---|---|---|
| `GET /shopping-lists` | liste famiglia | shopping.read |
| `POST /shopping-lists` | nuova lista | shopping.write |
| `GET /shopping-lists/{listId}` | lista dettagliata | shopping.read |
| `POST /shopping-lists/{listId}/items` | aggiunta manuale | shopping.write |
| `PATCH /shopping-lists/{listId}/items/{itemId}` | modifica/snooze/accept | shopping.write |
| `POST /shopping-lists/{listId}/items/{itemId}/complete` | acquisto completato | shopping.write |
| `POST /shopping-lists/{listId}/items/{itemId}/load-to-inventory` | carica stock confermato | inventory.write |
| `POST /shopping-lists/{listId}/batch-action` | accept/reject batch | shopping.write |
| `POST /shopping-lists/{listId}/archive` | archivia lista | shopping.write |

## Recipes/nutrition/offers

| Metodo/path | Use case | Scope |
|---|---|---|
| `GET /recipes/suggestions` | ranking asincrono/cacheable | recipe.read |
| `POST /recipes/jobs` | genera ranking/AI | recipe.write + consent |
| `GET /recipes/{recipeId}` | dettaglio/fonte | recipe.read |
| `POST /recipes/{recipeId}/plan` | pianifica porzioni | recipe.write |
| `POST /recipes/{recipeId}/add-missing` | aggiunge mancanti lista | shopping.write |
| `POST /recipes/{recipeId}/cook` | conferma cucina/consumo | inventory.write |
| `GET /nutrition/summary` | aggregato calorie/macro | nutrition.read |
| `GET /nutrition/products/{productId}` | valori/source | nutrition.read |
| `GET /offers` | offerte pertinenti | offers.read |
| `POST /offers/import-jobs` | import retailer | operator/tenant |
| `GET /offers/{offerId}` | dettaglio condizioni | offers.read |

## Notifications/privacy/admin

| Metodo/path | Use case | Scope |
|---|---|---|
| `GET /notifications` | centro notifiche | user |
| `PATCH /notification-preferences` | canali/quiet hours | user |
| `POST /privacy/export` | export asincrono | owner/user |
| `POST /privacy/erasure` | richiesta cancellazione | owner/user |
| `GET /privacy/consents` | consensi | user |
| `POST /privacy/consents/{purpose}` | grant/revoke | user |
| `GET /admin/jobs/{jobId}` | diagnosi job | operator scoped |
| `POST /admin/jobs/{jobId}/replay` | replay DLQ auditato | operator scoped |
| `GET /admin/audit` | audit filtrato | operator |
| `GET /health/live` | liveness | internal |
| `GET /health/ready` | readiness | internal |
| `GET /metrics` | Prometheus | internal |

## Errori comuni

`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND_OR_NOT_VISIBLE`, `VALIDATION_ERROR`, `CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `VERSION_CONFLICT`, `RATE_LIMITED`, `CAPABILITY_UNAVAILABLE`, `JOB_PENDING`, `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `CONSENT_REQUIRED`, `DATA_STALE`, `QUOTA_EXCEEDED`.

Ogni endpoint deve definire status code, esempio success/error, scope, family isolation, idempotenza, rate limit, metriche e audit.
