# Implementation status

**Snapshot:** 2026-09-09

## Current position

The repository has completed the foundation and platform identity milestones. It is an executable
engineering baseline, not yet a usable pantry product or production release.

## Completed and validated

| Task | Status | Evidence |
|---|---|---|
| `FND-TST-001` | complete | deterministic testkit, fixture factory, HTTP/database/queue seams, 6 tests |
| `FND-CON-001` | complete with hardening pending | expanded OpenAPI route inventory, common HTTP types, Redocly parse/lint |
| `FND-CON-002` | complete | versioned event/job schemas, registries, envelope validator, 2 tests |
| `FND-CFG-001` | complete | typed config loader, profiles, secret refs, fingerprint, 4 tests |
| `FND-OBS-001` | complete | redaction, context, metrics, traceparent, readiness, 4 tests |
| `FND-DAT-001` | complete | external migration runner, advisory lock, checksum drift, status, 5 tests |
| `RUN-OPS-001` | foundation complete | Compose API/PostgreSQL/Redis, health, resources, network, shutdown |
| `RUN-OPS-002` | configuration complete | Keycloak realm/PKCE client and MinIO bucket bootstrap/lifecycle |
| `RUN-OBS-001` | provisioning complete | OTel, Prometheus, Grafana, Alertmanager, Loki, Tempo configurations |
| `DOM-IDN-001` | complete at adapter level | JOSE JWT verification, OIDC discovery, principal mapping, 3 tests |
| `DOM-IDN-002` | complete at policy level | deny-by-default RBAC/ABAC boundary, family isolation, 4 matrix tests |
| `DOM-FAM-001` | complete at persistence/application boundary | family migration, active membership/owner constraints, atomic create contract, audit/outbox, 3 tests |
| `DOM-FAM-002` | complete at lifecycle boundary | hash-only QR/fallback tokens, expiry/revoke/consume states, browser-bound join attempt, atomic accept contract, 3 tests |
| `DOM-FAM-003` | complete at controller boundary | family create/invite/resolve/accept handlers, authz/error envelopes, compiled controller tests |
| `DOM-CAT-001` | complete at persistence/application boundary | catalog migration, products/sources/identifiers/provenance, manual precedence, 3 tests |
| `DOM-CAT-002` | complete at workflow boundary | normalized barcode lookup, unknown handling, reviewable imported candidates, 3 tests |
| `DOM-INV-001` | complete at persistence/application boundary | inventory locations/items/lots/movements/thresholds migration, quantity invariants, idempotent movement contract, 3 tests |
| `DOM-INV-002` | complete at controller boundary | inventory mutation handlers, family authorization, If-Match/version conflict, stable errors, 3 tests |
| `DOM-SHP-001` | complete at persistence/application boundary | shopping lists/items/sources migration, semantic dedupe boundary, validation service, 2 tests |
| `DOM-SHP-002` | complete at policy/application boundary | threshold boundary policy, version-based dedupe, ignored/snoozed protection, reorder event, 3 tests |
| `JOB-CORE-001` | complete at queue/job boundary | provider-neutral queue, lifecycle, bounded retry, inbox dedupe, attempts, DLQ, cancellation, graceful stop, metrics, 3 tests |
| `JOB-CORE-002` | complete at handler boundary | movement/reorder consumers, non-destructive reconciliation, projection rebuild boundary, 3 tests |
| `JOB-CORE-003` | complete at scheduler boundary | expiry/reconciliation/retention/backup schedule contracts, single-active lock, missed-run recovery, auditable statuses, 3 tests |
| `WEB-UI-001` | complete at shell boundary | accessible shell model, family navigation, explicit loading/offline/error states, safe redirects, 3 tests |
| `WEB-FAM-001` | complete at journey boundary | safe invite entry/review/accept state model, family welcome redirect, 3 tests |
| `WEB-INV-001` | complete at journey boundary | receipt/consume/waste action states, optimistic version propagation, conflict/offline/retry recovery, 3 tests |
| `WEB-SHP-001` | complete at journey boundary | shopping accept/reject/snooze/complete/edit states, list version propagation, conflict/offline/retry recovery, 3 tests |
| `JOB-NOT-001` | complete at notification boundary | opt-in preferences, quiet hours, idempotent delivery, provider boundary, transient failure and redaction tests |
| `OPS-REL-001` | complete at backup boundary | encrypted backup manifest, PostgreSQL/MinIO artifact references, isolated restore target, verification and redacted-log tests |

## Validation snapshot

The following checks pass in the repository:

- workspace build;
- workspace typecheck;
- workspace tests;
- Prettier on changed files;
- ESLint with warnings only for intentional bootstrap `console` output;
- Compose profile rendering;
- MinIO bootstrap shell syntax;
- OpenAPI parsing/linting without structural errors;
- migration runner tests;
- `git diff --check`.

JOB-CORE-001 focused validation:

- worker-core tests: 3 passing;
- API tests: no tests discovered;
- worker-core files pass targeted Prettier check;
- JOB-CORE-002 handler tests: 3 passing;
- JOB-CORE-003 scheduler tests: 3 passing;
- WEB-UI-001 shell tests: 3 passing;
- WEB-FAM-001 journey tests: 3 passing;
- WEB-INV-001 journey tests: 3 passing;
- WEB-SHP-001 journey tests: 3 passing;
- JOB-NOT-001 notification tests: 3 passing;
- OPS-REL-001 backup tests: 3 passing;
- repository-wide Prettier still reports the pre-existing baseline of 93 files.

Docker image build and container startup have not been evidenced in this snapshot because the
Docker Desktop Linux engine was not available during runtime checks. Compose configuration is
validated, but this is not equivalent to a successful `up` and health/readiness drill.

## Not implemented yet

### Product/domain core

- membership lifecycle beyond initial owner creation and atomic invite accept integration with real PostgreSQL;
- catalog API integration with real persistence and external provider adapter;
- real PostgreSQL inventory lock/rebuild integration;
- shopping conflict/controller integration;
- scheduler process and reconciliation jobs;
- scheduler process and reconciliation jobs;
- notifications and privacy export/erasure workflows;
- Next.js web/PWA and core user journeys.

### Operational proof

- real PostgreSQL migration execution and restore drill;
- real Keycloak login/PKCE flow;
- real MinIO upload/presigned URL flow;
- container health/readiness and trace drill;
- Grafana dashboards and alert delivery drill;
- security scans, load tests, resilience tests and accessibility E2E.

### Contract hardening

Some new OpenAPI operations still use shared generic request/response shapes. The next contract
hardening task must replace them with operation-specific schemas and complete uniform 4xx examples
before API freeze. The existing OpenAPI is structurally valid, but this item is not considered a
finished domain contract.

## Next execution order

1. `REL-TST-002`: integration resilience and failure-path suite.

### REL-TST-001 completed

The testkit now provides deterministic contract-case execution, authorization matrix assertions,
and an explicit in-memory inbox for idempotency tests. Focused testkit tests cover successful and
validation responses plus deny-by-default authorization and duplicate event claims.

Each task must follow [AGENT-WORK-PACKAGES.md](AGENT-WORK-PACKAGES.md) and update this status
snapshot only through the integration owner after its focused and workspace validation passes.
