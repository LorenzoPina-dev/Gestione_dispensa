# Atomic implementation backlog

Snapshot: 2026-09-09. This backlog decomposes the remaining runtime and release work into
single-owner tasks. A task is not complete when its source compiles: its acceptance evidence,
focused tests and handoff record must exist.

## Rules

- Execute one task at a time unless dependencies and file ownership are disjoint.
- Preserve the existing user change in `e2e/family-local.test.mjs`.
- Do not mark a boundary implementation as runtime-complete until it runs against PostgreSQL/Redis
  or the explicitly named local adapter.
- Every task updates `docs/IMPLEMENTATION-STATUS.md` only through the integration owner.
- Optional capabilities remain non-blocking for the family core.

## Phase A - contract and persistence closure

| ID | Owner | Depends on | Atomic output and acceptance |
|---|---|---|---|
| `CON-HARD-002` | CON | `FND-CON-001` hardening slice | Replace remaining generic OpenAPI request/response bodies for family, catalog, inventory, shopping, jobs, notifications and admin operations; add operation-level success and 4xx examples; contract lint passes. |
| `CON-HARD-003` | CON | `CON-HARD-002` | Add producer/consumer validators for every registered event/job and valid/missing/unknown/replay fixtures; registry and compatibility tests pass. |
| `DAT-RUN-001` | DAT | `FND-DAT-001`, domain migrations | Register all bounded-context migrations, add synthetic seed data, run against PostgreSQL, verify checksum/status and rollback notes. |
| `DAT-RUN-002` | DAT | `DAT-RUN-001` | Add integration fixtures for family, catalog, inventory, shopping, jobs, inbox/outbox and audit; prove foreign keys, unique constraints and family isolation against PostgreSQL. |

## Phase B - executable API and identity

| ID | Owner | Depends on | Atomic output and acceptance |
|---|---|---|---|
| `API-RUN-001` | PLT | `CON-HARD-002`, `DAT-RUN-001` | Compose the HTTP application from route modules with canonical envelopes, request IDs, error mapping and graceful shutdown; health/meta and route smoke tests pass. |
| `IDN-RUN-001` | IDN | `API-RUN-001`, `RUN-OPS-002` | Execute OIDC Authorization Code + PKCE against local Keycloak, validate issuer/audience/JWKS, map principal and reject invalid sessions; integration test passes. |
| `FAM-RUN-001` | FAM | `IDN-RUN-001`, `DAT-RUN-002` | Wire family/membership/invite repositories and controllers to PostgreSQL, including suspend/remove/role changes, cache invalidation and audit/outbox; authorization matrix passes. |
| `CAT-RUN-001` | CAT | `FAM-RUN-001`, `DAT-RUN-002` | Wire product/manual/barcode/provenance endpoints to PostgreSQL and adapter boundary; manual precedence and conflict resolution are persisted and tested. |
| `INV-RUN-001` | INV | `CAT-RUN-001`, `DAT-RUN-002` | Wire stock, lots, locations and movement endpoints to PostgreSQL transactions and locks; ledger rebuild, negative policy, idempotency and `If-Match` integration tests pass. |
| `SHP-RUN-001` | SHP | `INV-RUN-001`, `DAT-RUN-002` | Wire shopping list/item endpoints and reorder suggestions to PostgreSQL; optimistic conflicts, batch actions and family isolation pass in integration tests. |

## Phase C - jobs, workers and observability

| ID | Owner | Depends on | Atomic output and acceptance |
|---|---|---|---|
| `JOB-RUN-001` | JOB | `API-RUN-001`, `DAT-RUN-002` | Implement Redis queue adapter behind the existing queue interface with PostgreSQL recovery, bounded visibility timeout and deterministic fake parity; Redis integration tests pass. |
| `JOB-RUN-002` | JOB | `JOB-RUN-001`, `INV-RUN-001`, `SHP-RUN-001` | Make worker-core a runnable process with signal handling, inbox/outbox transaction boundary, retry/DLQ/replay and movement/reorder/reconciliation handlers; restart integration test passes. |
| `JOB-RUN-003` | JOB | `JOB-RUN-001`, `DAT-RUN-002` | Make scheduler a runnable process with PostgreSQL lease, missed-run recovery, expiry/reconciliation/retention/backup schedules and audit; single-active integration test passes. |
| `OBS-RUN-001` | OBS | `API-RUN-001`, `JOB-RUN-002`, `JOB-RUN-003` | Attach redacted structured logs, trace propagation, metrics and readiness dependencies to API, worker and scheduler; cross-process correlation test passes. |
| `ADMIN-RUN-001` | JOB/IDN | `JOB-RUN-002`, `OBS-RUN-001` | Add authorized job inspection, DLQ replay and audit endpoints; operator scope, replay idempotency and redaction tests pass. |

## Phase D - privacy, notifications and user-facing runtime

| ID | Owner | Depends on | Atomic output and acceptance |
|---|---|---|---|
| `PRV-RUN-001` | PLT | `API-RUN-001`, `JOB-RUN-002`, `DAT-RUN-002` | Implement authenticated export job creation, scoped artifact generation, expiry and download authorization; export integration and audit tests pass. |
| `PRV-RUN-002` | PLT | `PRV-RUN-001`, retention contract | Implement erasure request state machine, consent persistence, legal-retention anonymization and idempotent audit; privacy negative tests pass. |
| `NOT-RUN-001` | JOB | `JOB-RUN-002`, `DAT-RUN-002` | Wire notification preferences and in-app delivery to persistence and worker queues; quiet hours, consent, dedupe, unsubscribe and DLQ tests pass. |
| `WEB-RUN-001` | WEB | `API-RUN-001`, `IDN-RUN-001` | Convert shell model into a runnable Next.js/PWA shell with OIDC callback, family context, loading/offline/error states and no browser secrets; build and browser smoke test pass. |
| `WEB-RUN-002` | WEB | `WEB-RUN-001`, `FAM-RUN-001` | Implement onboarding, family creation, QR resolve/review/accept/reject, safe redirect and family switch routes; Playwright journey passes. |
| `WEB-RUN-003` | WEB | `WEB-RUN-001`, `INV-RUN-001`, `CAT-RUN-001` | Implement product add, barcode/photo/import recovery, receipt, consume, waste, expiry and conflict UI; keyboard/mobile and browser tests pass. |
| `WEB-RUN-004` | WEB | `WEB-RUN-001`, `SHP-RUN-001`, `NOT-RUN-001` | Implement dashboard and shopping journeys including batch actions, completion-to-stock, sharing, archive, notifications and recovery states; browser test passes. |

## Phase E - local runtime and release evidence

| ID | Owner | Depends on | Atomic output and acceptance |
|---|---|---|---|
| `OPS-RUN-001` | OPS | `API-RUN-001`, `JOB-RUN-002`, `JOB-RUN-003`, `OBS-RUN-001` | Boot family-local Compose with API, gateway, PostgreSQL, Redis, worker and scheduler; all probes, migrations, dependencies and graceful restarts pass. |
| `OPS-RUN-002` | OPS | `OPS-RUN-001`, `OPS-REL-001` | Execute PostgreSQL/MinIO backup and isolated restore against running services, record RTO/RPO and verify redacted logs. |
| `TST-E2E-001` | TST | `WEB-RUN-002`, `WEB-RUN-003`, `WEB-RUN-004`, `OPS-RUN-002` | Run synthetic first-use, QR, catalog, inventory, shopping, notification, backup/restore and trace journeys from clean Compose; all pass. |
| `SEC-RUN-001` | TST/OPS | `TST-E2E-001`, `WEB-RUN-003` | Execute SAST, dependency, secret, container, DAST, upload, SSRF, CSRF, XSS, rate-limit and authorization scans; no unresolved critical/high findings. |
| `OPS-EVID-001` | OPS | `TST-E2E-001`, `SEC-RUN-001` | Execute restart, Redis-loss, DLQ, telemetry-loss, disk-full, alert-delivery and load/SLO drills; publish measured evidence or accountable waivers. |
| `GOV-REL-001` | PLT | `PRV-RUN-002`, `SEC-RUN-001`, `OPS-EVID-001` | Refresh traceability, readiness, privacy/security approvals and release checklist; beta decision is supported by linked evidence. |

## Phase F - optional capability runtime integration

| ID | Owner | Depends on | Atomic output and acceptance |
|---|---|---|---|
| `INT-RUN-001` | INT | `CAT-RUN-001`, `JOB-RUN-002` | Wire barcode, provider catalog and manual fallback through real job/API paths with provenance and rate-limit degradation. |
| `INT-RUN-002` | INT | `INT-RUN-001`, `OPS-RUN-001` | Wire MinIO upload/quarantine/OCR recognition and review confirmation; malware, expiry and provider timeout journeys pass. |
| `INT-RUN-003` | INT | `INV-RUN-001`, `JOB-RUN-002` | Wire recipe/nutrition suggestions and confirmed consumption with consent, provenance and allergen hard constraints. |
| `INT-RUN-004` | INT | `SHP-RUN-001`, `JOB-RUN-002` | Wire retailer offer import and stale suppression to authorized operator jobs; source/license/freshness tests pass. |
| `INT-RUN-005` | JOB/INT | `CAT-RUN-001`, `INV-RUN-001`, `SHP-RUN-001` | Wire rebuildable search projection and authoritative fallback to event consumers; lag, replay and cross-family tests pass. |

## Explicitly deferred until evidence justifies them

Enterprise tenancy, SSO/SCIM, POS/ERP/webhooks, analytics warehouse, multi-region DR, OpenSearch,
graph projections, model governance and retailer expansion are not family-local blockers. They need
separate approved work packages after beta evidence and workload measurements.
