# Core worker

Durable consumer for inventory, reorder policy, shopping suggestions, outbox publishing, and
reconciliation jobs. Acknowledge messages only after the database side effect commits.

The queue and repository contracts are provider-neutral. Redis/BullMQ adapters must implement
`QueueAdapter` without becoming the source of truth: job state, attempts, inbox entries, and
dead-letter metadata belong to PostgreSQL. `JobWorker` classifies transient/permanent failures,
applies bounded backoff with deterministic injectable jitter, and acknowledges only after the
durable side effect and inbox completion succeed. `stop()` prevents new deliveries and supports
graceful shutdown after the current handler settles.
