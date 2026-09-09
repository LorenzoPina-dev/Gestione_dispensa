# REL-OPS-001 resilience and SLO evidence

Date: 2026-09-09

## Scope

This evidence covers deterministic worker failure-path assertions, synthetic latency measurement,
operational runbook completeness, and the existing backup/restore evidence. It does not claim high
availability for the single-host family-local profile.

## Evidence

| Drill or gate                        | Command                                         | Result                                                                         |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Synthetic API-core p95               | `node --test ops/rel-ops-001.test.mjs`          | PASS: 3 tests; synthetic p95 below 400 ms                                      |
| Retry/DLQ/ack ordering               | `node --test ops/rel-ops-001.test.mjs`          | PASS: transient classification, DLQ path, and ack-after-persistence assertions |
| Backup/restore artifact verification | `node --test infra/ops/backup.test.mjs`         | PASS: 3 tests                                                                  |
| Workspace build/typecheck            | `npm.cmd run build` and `npm.cmd run typecheck` | PASS                                                                           |
| Format and diff hygiene              | targeted Prettier and `git diff --check`        | PASS                                                                           |

## SLO status

The documented family-local targets remain the release baseline: API availability 99.9%, core
read p95 below 400 ms, inventory command p95 below 600 ms, queue success within 60 seconds at 99%,
and zero confirmed movement loss. The synthetic latency check is not a production measurement and
does not consume an error budget.

## Explicit waivers

Real Compose restart, Redis-loss, PostgreSQL restore, telemetry-backend loss, disk-full/OOM, and
alert-delivery drills are waived for this local evidence run because Docker Desktop Linux was not
available. Owner `OPS` must execute them before beta/release approval. The waiver does not claim
HA, RTO/RPO compliance, or successful alert delivery.

## Operational controls verified

- worker retries only classified transient failures and bounds attempts;
- exhausted jobs enter the DLQ with replay metadata;
- queue acknowledgement follows durable job and inbox updates;
- runbooks cover Redis loss, queue/DLQ backlog, telemetry loss, disk/OOM, backup restore, and
  recovery closure;
- every documented alert includes severity, SLO, window, owner, runbook, dashboard, and deduplication
  metadata requirements.
