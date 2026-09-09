# Scheduler

Single-active scheduler for reconciliation, expiry checks, retention tasks, backups, and provider
imports. Scheduling uses database locks and records an auditable execution status.

The scheduler uses `SchedulerRepository` as its persistence boundary. PostgreSQL advisory or
lease-backed locks must implement that contract; the in-memory repository is test-only. Missed
deadlines are recovered once per tick, task runs carry trace/status/duration metadata, and failed
or unconfigured optional tasks remain observable as `FAILED` or `DEGRADED`.
