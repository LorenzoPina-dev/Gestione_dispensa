# Observability

Shared logging, request context, metrics, tracing, redaction, and health probe conventions.
Audit events remain separate from operational logs.

The package provides framework-independent seams only: `RequestContext`, `RedactingLogger`,
`InMemoryMetrics`, W3C `traceparent` parsing, and readiness aggregation. Production exporters
and retention policies are configured in `infra/observability`; this package never sends data to
an external provider by itself.
