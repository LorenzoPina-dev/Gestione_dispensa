# Notification worker

Opt-in delivery worker for in-app, email, and push notifications. Provider failures are retried
with idempotency and sent to a dead-letter queue after bounded attempts.
