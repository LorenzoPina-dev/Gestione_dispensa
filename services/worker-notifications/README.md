# Notification worker

Opt-in delivery worker for in-app, email, and push notifications. Provider failures are retried
with idempotency and sent to a dead-letter queue after bounded attempts.

The worker uses explicit preference and provider boundaries. Consent is checked before delivery,
quiet hours defer without invoking a provider, duplicate deliveries are suppressed by the durable
repository, provider errors are classified as transient for the core retry/DLQ pipeline, and
payload text is redacted before leaving the service.
