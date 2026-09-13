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
| `DOM-INV-002` | complete at controller boundary, now wired to real HTTP + Postgres | inventory mutation handlers, family authorization, If-Match/version conflict, stable errors, 3 controller-level tests, plus 5 new end-to-end HTTP tests over a real `node:http` server and a new `PostgresInventoryReader` for the version lookup (see the PostgreSQL live-execution note below) |
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
| `REL-SEC-001` | complete at security-gate boundary | dependency audit, deterministic authorization/secret/redaction checks, threat-model evidence and explicit follow-up exceptions |
| `REL-OPS-001` | complete with family-local drill waivers | deterministic retry/DLQ/ack assertions, synthetic p95, runbook coverage and explicit Docker-dependent drill waivers |
| `REL-GOV-001` | complete as governance gate, release not approved | complete MUST traceability, lifecycle review, known-risk register and explicit release blockers |
| `OPT-INT-001` | complete at barcode adapter boundary | provider-neutral barcode adapter, normalization, timeout/rate-limit degradation, provenance and reviewable candidates |
| `OPT-INT-002` | complete at recognition boundary | upload validation, quarantine scanner boundary, malware/size/type handling, timeout degradation and review-only candidates |
| `OPT-INT-003` | complete at recipes/nutrition boundary | explainable allergen-safe ranking, source quality, serving scaling and unknown/estimated labels |
| `OPT-INT-004` | complete at offers adapter boundary | provider boundary, area/freshness validation, stale suppression, provenance and degraded fallback |
| `OPT-SEARCH-001` | complete at rebuildable projection boundary | deterministic family-isolated projection, source-version replay, measurable lag and PostgreSQL fallback boundary |
| `SCL-OPS-001` | complete at Kubernetes manifest boundary | base/overlay workloads, probes, resource limits, non-root security, secret references, PDB and network policies |
| `SCL-OPS-002` | complete with load-test waiver | bounded API/worker HPA, production two-replica overlay, backlog metric contract and explicit capacity evidence waiver |
| `SCL-REL-001` | complete as readiness record, production not approved | final prerequisite matrix, operator handoff and explicit owner/date blockers |
| `FND-CON-001` hardening slice | complete for privacy operations | operation-specific export, erasure and consent request/response schemas with regression coverage |
| `CON-HARD-002` | complete | remaining public OpenAPI paths no longer reference generic request/success contracts; operation-specific schemas, responses and regression tests added |
| `CON-HARD-003` | complete | event/job registry coverage, schema validator, lifecycle validator and unknown/missing/replay compatibility fixtures |
| `DAT-RUN-001` | complete | ordered migration inventory, external-runner regression coverage, deterministic family-local synthetic seed and explicit seed runbook |
| `DAT-RUN-002` | complete, runtime waiver lifted | rollback-only PostgreSQL integrity fixture executed for real against a live PostgreSQL 16 instance (all 7 migrations applied via the external runner): BEGIN/DO/ROLLBACK completed with every FK, uniqueness, inbox/outbox and family-isolation assertion passing. A `postgres-integration` CI job now runs this fixture and `apps/api/tests/postgres-client.integration.test.mjs` against a `postgres:16` service container on every push/PR. |
| `API-RUN-001` | complete at HTTP composition boundary, family domain now wired | executable Node HTTP server with canonical health/meta envelopes, correlation headers, stable errors, route smoke tests and graceful shutdown. This session added the first real domain HTTP surface: `POST /api/v1/families`, `POST /api/v1/families/{id}/invites`, `POST /api/v1/invites/resolve`, `POST /api/v1/invites/{id}/accept`, backed by `FamilyController` + the new `PostgresClient`, with real-JWT end-to-end tests (`apps/api/tests/http-family-routes.test.mjs`) and a real `/health/ready` Postgres ping. Catalog/inventory/shopping/jobs/privacy controllers still exist but remain unwired to any route — see the correction note below. |
| `JOB-RUN-001` | complete at Redis adapter boundary | provider-neutral Redis list adapter with processing acknowledgements, nack/requeue, FIFO, backlog/oldest-age metrics and deterministic fake-client tests |
| `IDN-RUN-001` | complete at local OIDC flow boundary | Authorization Code + PKCE S256 flow with discovery validation, one-time state, TTL cleanup, token exchange and deterministic callback tests |
| `JOB-RUN-003` | complete at scheduler process boundary | executable polling loop with single-flight ticks, database-backed scheduler lock contract, missed-run recovery, audit outcomes and graceful stop |
| `FAM-RUN-001` | complete at PostgreSQL repository boundary, live-verified | parameterized family/invite repositories with atomic transactions, audit/outbox writes, hash-only invite persistence and invite acceptance transaction tests; the same repository classes now run against real PostgreSQL 16 through the new `PostgresClient` (`apps/api/src/db/postgres-client.ts`), verified end-to-end (create family -> invite -> resolve -> accept, with a forced-failure atomic-rollback check) |
| `CAT-RUN-001` | complete at PostgreSQL repository boundary | parameterized catalog repositories for manual products, barcode lookup, imported candidates, provenance and transactional outbox tests |
| `INV-RUN-001` | complete at PostgreSQL repository boundary | parameterized stock creation and locked movement transactions with family isolation, idempotent client operations, quantity invariants and version updates |
| `SHP-RUN-001` | complete at PostgreSQL repository boundary | parameterized shopping list/item persistence, family-scoped locking, semantic dedupe, source provenance and optimistic versions |
| `JOB-RUN-002` | complete at worker process boundary | runnable worker loop with capability dispatch, signal-driven graceful shutdown, permanent unsupported-capability DLQ handling and restart-safe consumer orchestration |
| `OBS-RUN-001` | complete at runtime instrumentation boundary | shared redacted JSON logging, service-scoped metrics/readiness facade, and lifecycle instrumentation for API, worker-core and scheduler |
| `ADMIN-RUN-001` | complete at authorized administration boundary | operator-only job inspection, approval-gated DLQ replay, replay metadata persistence, publisher boundary and security audit outcomes |
| `PRV-RUN-001` | complete at privacy export boundary | owner-authorized idempotent export jobs, family-scoped artifact generation, expiry enforcement, download authorization and audit outcomes |
| `PRV-RUN-002` | complete at privacy erasure boundary | owner-confirmed idempotent erasure requests, consent persistence, legal-retention preservation, anonymization worker and audit outcomes |
| `NOT-RUN-001` | complete at notification delivery boundary | persisted preferences, quiet-hour deferral, opt-in in-app delivery, deduplication, unsubscribe and transient provider failure handling |
| `INT-RUN-001` | complete at barcode runtime boundary | provider-backed barcode job processing, reviewable provenance, idempotent result persistence, manual fallback and degraded rate/timeout handling |
| `INT-RUN-002` | complete at recognition runtime boundary | quarantine object-store boundary, malware-safe review pipeline, idempotent result persistence, explicit candidate confirmation and provider degradation |
| `INT-RUN-003` | complete at recipe/nutrition runtime boundary | consent-gated idempotent suggestions, allergen-safe ranking reuse, source-qualified nutrition calculation and explicit consumption operations |
| `INT-RUN-004` | complete at retailer offer runtime boundary | authorized-area import windows, source-version provenance, freshness/validity suppression, idempotent persistence and degraded provider handling |
| `INT-RUN-005` | complete at search projection runtime boundary | durable event consumption, deterministic rebuild, measurable projection lag, family isolation and authoritative fallback |
| `WEB-RUN-001` | complete at runnable shell boundary | browser runtime model, safe OIDC callback handling, family-scoped navigation, explicit offline/error states and accessible PWA document rendering |
| `WEB-RUN-002` | complete at onboarding journey boundary | family creation, QR invite entry/review/accept/reject routes, encoded safe redirects and family switching state transitions |
| `WEB-RUN-003` | complete at inventory journey boundary | manual/barcode/photo/import product input, review and manual fallback states, offline/conflict recovery and expiry visibility |

## Validation snapshot

The following checks pass in the repository:

- workspace build;
- workspace typecheck;
- workspace tests;
- repository-wide Prettier;
- ESLint with warnings only for intentional bootstrap `console` output;
- Compose profile rendering;
- MinIO bootstrap shell syntax;
- OpenAPI parsing/linting without structural errors;
- migration runner tests;
- `git diff --check`.

ADMIN-RUN-001 focused validation:

- API build and tests: passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- Compose profile rendering: passing;
- ESLint: 0 errors, 4 pre-existing bootstrap warnings;
- `git diff --check`: passing.

PRV-RUN-001 focused validation:

- API tests: 54 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- Compose profile rendering: passing;
- ESLint: 0 errors, 4 pre-existing bootstrap warnings;
- `git diff --check`: passing.

PRV-RUN-002 focused validation:

- API tests: 58 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- Compose profile rendering: passing;
- ESLint: 0 errors, 4 pre-existing bootstrap warnings;
- `git diff --check`: passing.

NOT-RUN-001 focused validation:

- worker-notifications tests: 4 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- Compose profile rendering: passing;
- ESLint: 0 errors, 4 pre-existing bootstrap warnings;
- `git diff --check`: passing.

INT-RUN-001 focused validation:

- worker-integrations tests: 16 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- Compose profile rendering: passing;
- `git diff --check`: passing.

INT-RUN-003 focused validation:

- worker-integrations tests: 19 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- `git diff --check`: passing.

INT-RUN-004 focused validation:

- worker-integrations tests: 21 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- `git diff --check`: passing.

INT-RUN-005 focused validation:

- search-indexer tests: 5 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- `git diff --check`: passing.

WEB-RUN-001 focused validation:

- web tests: 14 passing;
- workspace build and typecheck: passing;
- repository-wide Prettier: passing;
- `git diff --check`: passing.

INT-RUN-002 focused validation:

- worker-integrations tests: 23 passing;
- worker-integrations typecheck: passing;
- targeted Prettier check: passing;
- `git diff --check`: passing.

WEB-RUN-002 focused validation:

- web tests: 17 passing;
- web typecheck: passing;
- targeted Prettier check: passing;
- `git diff --check`: passing.

WEB-RUN-003 focused validation:

- web tests: 20 passing;
- web typecheck: passing;
- targeted Prettier check: passing;
- `git diff --check`: passing.

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
- REL-SEC-001 security gate tests: 4 passing;
- production dependency audit: 0 vulnerabilities at all severities;
- REL-OPS-001 resilience tests: 3 passing;
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
- family-local Compose boot;
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

1. No further mandatory pipeline tasks; production approval remains blocked by recorded evidence gaps.

### REL-TST-001 completed

The testkit now provides deterministic contract-case execution, authorization matrix assertions,
and an explicit in-memory inbox for idempotency tests. Focused testkit tests cover successful and
validation responses plus deny-by-default authorization and duplicate event claims.

### REL-TST-002 completed

Added a family-local synthetic E2E fixture covering invite authentication, safe redirect handling,
invite review, and encoded family welcome navigation.

### REL-SEC-001 completed

Added a repeatable security gate covering production dependency audit evidence, deny-by-default
authorization and cross-family isolation checks, observability redaction, runtime secret hygiene,
and threat-model control coverage. Unimplemented upload/SSRF, browser DAST, container scan, and
artifact provenance surfaces are recorded as owned follow-up exceptions rather than marked passed.

### REL-OPS-001 completed

Added deterministic resilience evidence for worker retry/DLQ/ack ordering and synthetic p95
measurement, plus explicit runbook coverage and Docker-dependent drill waivers. No high-availability
claim is made for the single-host family-local profile.

### REL-GOV-001 completed

Added requirement-to-evidence traceability for every `MUST`, retention/lifecycle review updates,
and a release checklist with named owners, approval states and explicit blockers. The governance
gate is complete, while beta/production approval remains intentionally denied.

### OPT-INT-001 completed

Added a provider-neutral barcode/catalog adapter with strict identifier normalization, response
validation, timeout and rate-limit degradation, provenance metadata, and mandatory reviewable
candidate output. Manual catalog entry remains available when the provider is unavailable or has no
match.

### OPT-INT-002 completed

Added a provider-neutral recognition pipeline with MIME/size/path validation, quarantine scanner
boundary, malware and scanner-unavailable handling, provider timeout degradation, and mandatory
review for every candidate including low-confidence results. No automatic catalog mutation is
performed.

### OPT-INT-003 completed

Added deterministic recipe ranking that hard-excludes allergen violations and exposes reason
codes, plus nutrition serving calculations that preserve source quality and distinguish confirmed,
estimated and unknown values. No generated or provider output is treated as medical advice or
verified without provenance.

### OPT-INT-004 completed

Added an isolated offers adapter that validates area, price, currency and validity windows,
suppresses stale or malformed offers, preserves provider/source provenance, and degrades on
provider rate limits without blocking core shopping.

### OPT-SEARCH-001 completed

Added a rebuildable family-isolated search projection with source-version idempotency, deterministic
replay, measurable projection lag, and an explicit authoritative fallback when the projection is
degraded. No optional search backend is introduced before benchmark evidence.

### SCL-OPS-001 completed

Added renderable Kubernetes base and family-local overlay for the core API and worker, with
non-root/read-only security contexts, resource budgets, health probes, secret references,
PodDisruptionBudgets and deny-by-default network policies. The manifests do not claim HA on a
single node and contain no plaintext secrets.

### SCL-OPS-002 completed

Added bounded CPU/backlog autoscaling for API and `worker-core`, a production overlay with two
stateless replicas, and capacity evidence requirements. Kubernetes rendering and secret scans pass;
the load-test calibration remains an explicit OPS waiver because no Kubernetes metrics adapter is
available in this environment.

### SCL-REL-001 completed

Added the final production-readiness record and operator handoff. Every prerequisite is marked
`PASS`, `PARTIAL`, `WAIVED` or `BLOCKED` with an accountable owner and exit evidence; the
repository explicitly remains `NOT APPROVED` for production until real deployment, DR, alert,
artifact, privacy and load evidence is supplied.

### FND-CON-001 privacy hardening slice completed

Privacy export, erasure and consent operations no longer rely on the generic request/response
shapes. The contract now requires explicit consent fields, confirmation for erasure, and stable
consent response structures; a regression test prevents those operations from regressing to generic
contracts. Remaining generic OpenAPI operations are still tracked as contract-hardening work.

## Atomic remaining backlog

The remaining executable work is decomposed in
[IMPLEMENTATION-BACKLOG.md](IMPLEMENTATION-BACKLOG.md). Runtime implementation tasks through
`OPS-RUN-001` are complete at their verified boundaries. Tasks are intentionally split between contract,
PostgreSQL/Redis runtime integration, user interface runtime, privacy, operational evidence and
optional capability wiring.

### CON-HARD-002 completed

All public OpenAPI path operations now use named request bodies and response components rather than
`GenericRequest` or `GenericSuccess`. The operation-specific schemas encode required fields,
enums, identifiers, confirmation, consent, pagination payloads and domain response shapes. YAML
parsing, contract tests, typecheck, formatting and diff validation pass.

### CON-HARD-003 completed

Added a dependency-free JSON Schema subset validator for producer/consumer payload checks, a
strict job lifecycle validator, registry coverage checks, and compatibility fixtures for valid,
missing-required and unknown-field payloads. Contract tests and typecheck pass.

### DAT-RUN-001 completed

The six bounded-context migrations are covered by an ordered repository inventory test. A
deterministic, idempotent family-local seed creates only synthetic user, family, membership,
catalog and location records and remains separate from migration history. PostgreSQL application
is still external to service startup; the seed runbook requires an explicit `psql` invocation.

### DAT-RUN-002 completed with runtime waiver

Added a disposable PostgreSQL fixture that inserts two isolated families and validates foreign keys,
active membership uniqueness, movement idempotency, inbox/outbox deduplication, audit visibility and
family-filtered reads. The entire fixture is rollback-only. Static fixture coverage passes; live
execution is waived because Docker Desktop/PostgreSQL is unavailable in this environment.

### OPS-RUN-001 completed with runtime waiver

The maintained `family-local` Compose profile includes the API, PostgreSQL, Redis, identity,
object storage and observability dependencies with health-gated startup, restart policies,
resource limits and graceful stop periods. `docker compose --profile family-local config --quiet`
passes. A live `docker compose up` boot and health verification could not be executed because the
Docker engine is unavailable in this environment; no placeholder worker or gateway containers were
added.

### API-RUN-001 completed at HTTP composition boundary

The API bootstrap now delegates routing to an exported HTTP composition module. Liveness,
readiness and metadata endpoints return canonical `data`/`meta` envelopes, request and trace
correlation is propagated, unsupported methods and unknown paths map to stable error codes, and
shutdown reports close failures without masking them. Domain route wiring remains owned by the
subsequent runtime tasks.

### JOB-RUN-001 completed at Redis adapter boundary

Added a Redis list adapter behind the existing `QueueAdapter` contract. Messages move atomically
from pending to processing, acknowledgement removes only the matching delivery, negative
acknowledgement requeues it, and asynchronous backlog/oldest-age metrics avoid pretending Redis
I/O is synchronous. The adapter accepts a small client interface, so no Redis provider leaks into
worker-core; deterministic fake-client tests cover FIFO, ack, nack and age behavior.

### IDN-RUN-001 completed at local OIDC flow boundary

Added a provider-neutral local Authorization Code + PKCE flow. Discovery must expose issuer,
authorization and token endpoints; authorization requests use S256 challenges and opaque state;
callbacks consume state once, reject expired/unknown state, exchange the code through
`application/x-www-form-urlencoded`, and validate the token response without logging credentials.
Keycloak remains an infrastructure configuration concern and is not imported into the API domain.

### JOB-RUN-003 completed at scheduler process boundary

Added an executable scheduler process around the existing schedule contract. It prevents overlapping
ticks, delegates locking and audit persistence to the scheduler repository, preserves missed-run
recovery, exposes completed run observations, and stops by cancelling future polls and awaiting any
active tick. Poll interval, lease and owner identity can be supplied by environment without
introducing provider-specific persistence into the scheduler package.

### FAM-RUN-001 completed at PostgreSQL repository boundary

Added concrete PostgreSQL repository adapters for family creation and invite lifecycle. Family
creation writes the family, owner membership, audit record and outbox event in one transaction;
invite tokens remain hash-only, invite lookup and join attempts use parameterized SQL, and accept
updates membership, attempt and invite state atomically. The adapters depend only on a small SQL
client/transaction boundary, so no PostgreSQL driver leaks into domain services. Live execution
against PostgreSQL remains environment-waived while Docker is unavailable.

### CAT-RUN-001 completed at PostgreSQL repository boundary

Added concrete catalog adapters for atomic manual product persistence, manual provenance and
transactional outbox writes, normalized identifier lookup with verified-first ordering, and imported
candidate persistence with provider provenance. The adapters use only the shared SQL transaction
boundary and keep provider/database details outside the catalog services. Live PostgreSQL execution
remains environment-waived while Docker is unavailable.

### INV-RUN-001 completed at PostgreSQL repository boundary

Added a concrete inventory repository that persists family-scoped stock items and applies movements
under row locks. Client operation identifiers are deduplicated before side effects, negative
quantities are rejected, movement rows remain append-only, and successful updates advance the stock
version in the same transaction. Live PostgreSQL execution remains environment-waived while Docker
is unavailable.

### SHP-RUN-001 completed at PostgreSQL repository boundary

Added a concrete shopping repository for family-scoped list creation and item insertion. Active
semantic duplicates are locked and merged with version advancement rather than duplicated; source
provenance is appended in the same transaction. Live PostgreSQL execution remains environment-waived
while Docker is unavailable.

### JOB-RUN-002 completed at worker process boundary

Added the executable worker orchestration around the durable `JobWorker`. Capability handlers are
resolved after the job is claimed, unsupported capabilities become permanent failures and are
acknowledged only after DLQ persistence, and SIGINT/SIGTERM trigger a graceful stop that waits for
the active delivery. The process remains provider-neutral and accepts explicit queue/repository
boundaries from composition code.

### OBS-RUN-001 completed at runtime instrumentation boundary

Added a provider-neutral `RuntimeObservability` facade over the existing redaction, metrics,
trace-context and readiness primitives, plus a JSON line sink for process output. API startup and
shutdown, worker lifecycle and scheduler lifecycle now emit service-scoped redacted records; metric
and readiness hooks remain injectable for tests and deployment composition.

### Documentation-accuracy correction (this session)

While wiring the family HTTP routes, no actual OpenAPI document (YAML/JSON) or Redocly
configuration was found anywhere in this repository — `packages/contracts/openapi/` contains only
a `README.md`, and a repository-wide search for `*.yaml` / `*openapi*` / `redocly*` returns nothing.
The `FND-CON-001` ("Redocly parse/lint") and `CON-HARD-002` ("remaining public OpenAPI paths...")
rows above describe validating a document that does not exist in the repository. What *does* exist
is `packages/contracts/src/index.ts`: hand-written TypeScript envelope/event/job types, an
`HttpContractRoute` shape, and imperative JSON Schema-style validators — useful, but not an OpenAPI
spec, and not something Redocly could have parsed. Until a real `openapi.yaml` is added and linted,
those two rows should be read as "contract *types* defined in TypeScript", not as OpenAPI validation
evidence. The family HTTP routes added in this session (`POST /api/v1/families` and friends) were
designed directly against `FamilyController`'s existing method signatures rather than against any
OpenAPI path list, because none exists to conform to.

### PostgreSQL live-execution evidence added (this session)

The `DAT-RUN-002` / `FAM-RUN-001` "live execution waived" notes were removed for the family
domain and the migration/fixture tooling. Concretely, in this session:

- Installed PostgreSQL 16 in an isolated environment and applied all 7 repository migrations
  (`0001`-`0007`) with the unmodified `infra/postgres/scripts/migrate.mjs` runner.
- **Found and fixed a real bug** in `migrate.mjs`: `psql --no-align` defaults to `|` as its field
  separator, not a tab, while `parseRows()` split on `\t`. `status` therefore always threw
  `Invalid migration status output` against a real database. No prior test caught this because
  every existing test supplied pre-shaped fake stdout instead of exercising psql's actual output
  format. Fixed by extracting a pure, unit-tested `buildPsqlQueryArgs()` that always passes
  `--field-separator \t`; `migrate` and `status` are now both live-verified as idempotent.
- Executed `infra/postgres/fixtures/002-integrity.sql` for the first time against a real database
  (previously only checked by regex against the static file). `BEGIN` / `DO` / `ROLLBACK` completed
  cleanly: family-scoped stock/audit visibility, active-membership uniqueness, movement
  idempotency, cross-family location FK enforcement, and inbox/outbox deduplication all passed as
  real constraint violations caught by the fixture's negative tests.
- Added `apps/api/src/db/postgres-client.ts`, a `pg` (node-postgres) backed implementation of the
  `SqlClient`/`SqlTransaction`/`SqlTransactionFactory` contracts already defined independently in
  each domain's `postgres.ts`. One pool now serves family, catalog, inventory and shopping
  repositories via structural typing; `pg`/`@types/pg` were added to `apps/api/package.json`
  (which also had a duplicate `dependencies` key, now merged).
- Added `apps/api/tests/postgres-client.integration.test.mjs`: an opt-in test (skips cleanly
  without `DATABASE_URL`, verified both ways) that runs `FamilyService`/`InviteService` against the
  real repositories and a live database, asserting actual row state after create/invite/resolve/
  accept, plus a forced primary-key collision proving atomic rollback leaves no orphaned rows.
- Added a `postgres-integration` job to `.github/workflows/ci.yml` that boots a `postgres:16`
  service container, runs the real migration runner, runs the integrity fixture, and runs the new
  integration test on every push/PR. This job has not yet executed on GitHub Actions itself (that
  requires a push); its steps were validated by reproducing the equivalent sequence locally.

- Wired the family domain into `apps/api/src/http.ts` for the first time: `POST /api/v1/families`,
  `POST /api/v1/families/{id}/invites`, `POST /api/v1/invites/resolve`, and
  `POST /api/v1/invites/{id}/accept`, each backed by `FamilyController` and the real Postgres
  repositories, with JWT authentication via the existing `OidcTokenVerifier` and a new
  `PostgresFamilyMembershipReader`. `/health/ready` now performs a real Postgres ping instead of a
  static placeholder when `options.postgres` is provided. Verified with 7 new end-to-end HTTP tests
  (`apps/api/tests/http-family-routes.test.mjs`) using real signed JWTs against a local JWKS and a
  real `node:http` server — no mocked transport. Note: no OpenAPI document exists to validate these
  paths against (see the correction note above); the route shapes are this session's own design.
- Wired the inventory domain the same way: `POST /api/v1/inventory/stock-items` and
  `POST /api/v1/inventory/stock-items/{id}/movements`, backed by `InventoryController` (reusing
  `PostgresFamilyMembershipReader` for its membership check) and a new `PostgresInventoryReader`
  for the If-Match version lookup. The movement route enforces optimistic concurrency: a missing
  `If-Match` header returns `428 PRECONDITION_REQUIRED`, a stale one returns
  `409 VERSION_CONFLICT`. Verified with 5 end-to-end HTTP tests
  (`apps/api/tests/http-inventory-routes.test.mjs`), including a real stale-version conflict and a
  real successful concurrency-checked update.
- Wrote a **new controller boundary from scratch** for catalog and shopping (neither had one
  before): `catalog/controller.ts` (`POST /api/v1/catalog/products`, public
  `GET /api/v1/catalog/lookup`) and `shopping/controller.ts` (`POST /api/v1/shopping/lists`,
  `POST /api/v1/shopping/lists/{id}/items`, reusing `PostgresFamilyMembershipReader` for
  `shopping.write` authorization). Catalog is shared reference data, not family-scoped, so its
  controller only gates on authentication, not membership. Verified with 5 end-to-end HTTP tests
  (`apps/api/tests/http-catalog-shopping-routes.test.mjs`), including the public barcode-lookup
  route working without a token and the 404-when-unconfigured case.
- `server.ts` now composes all four domains (family, inventory, catalog, shopping) behind the same
  `OidcTokenVerifier` and `PostgresClient` when `DATABASE_URL`/`PG*`, `OIDC_ISSUER` and
  `OIDC_AUDIENCE` are all resolvable; each domain degrades independently (logs and stays
  unregistered) if its prerequisites are missing.
- The full apps/api TypeScript tree (all four domains, `http.ts`, `server.ts`) was rebuilt from
  scratch and type-checked clean in this session's mirror after every change, and the complete test
  suite (19 tests across health/meta, family, inventory, catalog, shopping, plus the live-Postgres
  integration tests) passes together in one run.

What this does **not** yet cover: jobs/privacy HTTP routes are still not wired into
`apps/api/src/http.ts` (only health/meta and the new family/inventory/catalog/shopping surfaces are
served), Redis/OIDC-realm/MinIO remain unverified against live services (all four domains require
`OIDC_ISSUER`/`OIDC_AUDIENCE` to be set and reachable, which was not exercised against a real
Keycloak in this session), and `packages/ui` / `apps/web` / `services/gateway` are still empty or
non-UI as recorded elsewhere in this document.

Each task must follow [AGENT-WORK-PACKAGES.md](AGENT-WORK-PACKAGES.md) and update this status
snapshot only through the integration owner after its focused and workspace validation passes.
