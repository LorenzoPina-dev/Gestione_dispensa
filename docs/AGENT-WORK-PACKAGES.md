# Agent work-package protocol

## 1. Mission

This protocol governs parallel coding agents working on the implementation pipeline. It exists to
make work composable: one agent produces a bounded artifact, another can consume it by contract,
and no agent relies on undocumented edits in a shared file.

The canonical task definition is in [IMPLEMENTATION-PIPELINE.md](IMPLEMENTATION-PIPELINE.md).
This document defines how a task is assigned, executed, reviewed, integrated, and closed.

## 2. Assignment template

Every agent receives one task ID and the following exact brief:

```text
Task ID: <stable id>
Lane: <PLT|CON|CFG|OBS|IDN|FAM|CAT|INV|SHP|INT|JOB|WEB|DAT|OPS|TST>
Objective: <one measurable sentence>
Depends on: <task IDs and artifact versions>
Read first: <specific contracts/files>
Allowed files: <exact paths or non-overlapping glob patterns>
Forbidden files: <explicit shared and neighboring paths>
Required outputs: <files, APIs, events, migrations, tests, evidence>
Validation commands: <exact commands>
Acceptance criteria: <binary checks>
Handoff target: <next task IDs>
```

A brief with an ambiguous allowed-file boundary is invalid and must be clarified before coding.

## 3. Input rules

An agent may use as input only:

- the files listed in `Read first`;
- the stable contracts referenced by the task;
- outputs from completed dependency tasks;
- the current repository state, including user changes, without reverting them.

An agent must not infer a new public field, event, table, permission, provider, or deployment
resource when the contract does not define it. The agent must open a contract task or report a
blocker.

All input versions must be recorded in the handoff. For generated inputs, record the generator
command and source path.

## 4. Output rules

Every output must be one of:

- source implementation inside the allowed boundary;
- migration owned by the task's schema owner;
- contract/schema/versioned fixture;
- test and test fixture;
- configuration/provisioning owned by the lane;
- documentation evidence explicitly listed in the task.

Generated output must be reproducible and either committed in its designated directory or ignored
by repository policy. Never commit `dist/`, local volumes, credentials, token material, provider
responses containing personal data, or editor state.

## 5. Shared-file protocol

The following files are integration-only unless a task explicitly owns them:

- root `package.json` and `package-lock.json`;
- root TypeScript, ESLint, Prettier and Docker entrypoints;
- `README.md` indexes;
- `.github/**`;
- `docker-compose.yml`;
- contract indexes and generated barrels;
- migration registries/checksums;
- release traceability, readiness and final runbooks.

Feature agents must return a patch request in the handoff instead of editing these files. The
integration owner applies it after checking all pending work packages.

## 6. Implementation constraints

### API

- Use `/api/v1` and the canonical envelope.
- Validate input before domain logic.
- Require idempotency for repeatable mutations.
- Return stable error codes, not internal errors or SQL details.
- Enforce household context at the application boundary and again at repository policy boundaries.
- Do not call slow providers synchronously in a core request.

### Database

- PostgreSQL is authoritative.
- Every shared household table has `family_id`/`household_id` as defined by the ERD.
- Ledger and audit records are append-only.
- Migrations use expand-contract and run through the external migration runner.
- A service may write only its owned tables.
- Projections and caches are rebuildable and never become silent authorities.

### Events and jobs

- Validate schema before business logic.
- Publish through transactional outbox.
- Consume with inbox/idempotency protection.
- Acknowledge after durable side effects commit.
- Retry only classified transient failures with bounded backoff/jitter.
- Put poison messages in a DLQ with replay metadata and audit.
- Propagate W3C trace context and never include secrets or unnecessary PII.

### Web

- Consume generated/public API clients, never service internals or database access.
- Represent loading, pending, degraded, offline, conflict, retry, and empty states.
- Use accessible controls and keyboard/focus behavior.
- Keep optimistic actions idempotent and reconcile conflicts explicitly.
- Do not store sensitive tokens or food payloads in unapproved browser storage.

### Infrastructure

- Configuration is profile-driven and validated before startup.
- Secrets are references or runtime-injected values only.
- Health, readiness, resource limits, graceful shutdown, logs and telemetry are mandatory.
- Optional capabilities fail as `PENDING`, `DEGRADED`, or `UNAVAILABLE`; core services do not crash
  because an optional provider is disabled.

## 7. Required handoff report

The agent must finish with this exact structure in the task record or pull request:

```markdown
## Task handoff: <TASK-ID>

### Result
- status: DONE | BLOCKED | NEEDS_REVIEW
- summary: <one paragraph>

### Files changed
- `<path>`: <why>

### Contracts consumed
- `<path>@<version>`: <relevant section>

### Outputs
- API/events/jobs/migrations/config/tests: <list>

### Validation
- `<exact command>`: PASS | FAIL
- `<exact command>`: PASS | FAIL

### Security/privacy/operations
- authorization: <evidence>
- redaction: <evidence>
- degraded mode: <evidence>
- migration/rollback: <evidence or N/A>

### Known limits
- <explicit limitation or `none`>

### Next tasks unlocked
- <task IDs>

### Integration request
- <shared-file patch request or `none`>
```

A task marked `DONE` without this report is not eligible for integration.

## 8. Review protocol

The reviewer checks in this order:

1. task boundary and allowed files;
2. dependency artifacts and contract version;
3. behavior and invariants;
4. authorization and household isolation;
5. idempotency/concurrency/retry behavior;
6. telemetry and redaction;
7. migration safety and rollback;
8. tests and negative cases;
9. documentation and handoff completeness.

Reviewers do not expand scope during review. New issues become new task IDs unless they block the
current acceptance criteria.

## 9. Integration protocol

- Integrate one task or one explicitly compatible batch at a time.
- Run the task's narrow validation before any broad validation.
- Rebase or merge only through the integration owner; never rewrite another agent's branch.
- After integration, run structure, typecheck, contract tests and affected integration tests.
- Update the dependency ledger only after validation passes.
- A failed integration is returned to the owning lane with the exact failure and reproduction.

## 10. Status vocabulary

- `READY`: dependencies complete and brief is unambiguous;
- `IN_PROGRESS`: one agent owns the task;
- `BLOCKED`: a named prerequisite or contract decision is missing;
- `NEEDS_REVIEW`: implementation and evidence are present;
- `INTEGRATED`: merged and broad validation passes;
- `DONE`: integrated, documented, and release evidence recorded;
- `DEFERRED`: intentionally moved to a later release with owner and reason.

## 11. Anti-conflict checklist

Before starting:

- [ ] task ID is unique and assigned to one agent;
- [ ] dependencies are complete;
- [ ] allowed files do not overlap an active task;
- [ ] contracts and schema versions are recorded;
- [ ] migration ownership is clear;
- [ ] integration owner is known.

Before handoff:

- [ ] no forbidden file changed;
- [ ] no unrelated formatting or refactor;
- [ ] tests include failure and authorization paths;
- [ ] output is reproducible;
- [ ] secrets and personal data are absent;
- [ ] exact validation output is recorded.
