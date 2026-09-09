# Implementation status

## JOB-CORE-001

- Status: `NEEDS_REVIEW`
- Scope: provider-neutral queue/job infrastructure in `services/worker-core`.
- Delivered: lifecycle states, bounded retry with backoff/jitter, inbox deduplication, attempts,
  dead-letter metadata, cancellation boundary, graceful stop, post-side-effect ack, error
  classification, queue metrics sink, and PostgreSQL-owned tables.
- Validation evidence is recorded after the focused worker tests and repository-wide checks.

### Validation

- `npm.cmd --workspace @gestione-dispensa/worker-core test`: PASS (3 tests).
- `npm.cmd --workspace @gestione-dispensa/api test`: PASS (0 tests discovered).
- `npm.cmd run build`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS with four pre-existing `no-console` warnings.
- `docker compose --profile family-local config --quiet`: PASS.
- `git diff --check`: PASS.
- `npm.cmd run format:check`: FAILS on the repository baseline (93 pre-existing files); all
  JOB-CORE-001 files were formatted individually.

### Handoff

- Authorization: job reads remain behind the owning service boundary; DLQ replay metadata carries
  queue, error class/code, attempt count, timestamps, and replay count.
- Redaction: payloads are not logged or emitted by the queue metrics sink.
- Degraded mode: `DEGRADED` is part of the persisted lifecycle and can be resumed or cancelled.
- Migration/rollback: `002_jobs.sql` is additive and registered through `schema_migrations`.
- Known limits: Redis/BullMQ and PostgreSQL runtime adapters are intentionally not included in this
  provider-neutral core task.
- Next tasks unlocked: `JOB-CORE-002`, `JOB-CORE-003`.
- Integration request: none.
