# Observability

Observability is a first-class platform capability of Gestione Dispensa. No business service is considered complete until its operations are measurable and traceable.

## Stack

| Layer | Component | Purpose |
|---|---|---|
| Edge | NGINX | TLS termination, request boundary |
| Metrics | Prometheus | time-series metrics and alert source |
| Dashboards | Grafana | operational UI |
| Logs | Loki + Grafana Alloy | structured/container log aggregation |
| Traces | OpenTelemetry Collector + Tempo | distributed traces |
| Containers | cAdvisor | CPU, memory, filesystem and container load |
| PostgreSQL | postgres-exporter | DB connections, transactions, locks and query statistics |
| Redis | redis-exporter | memory, commands and keyspace metrics |
| Kafka | kafka-exporter | broker/topic/consumer metrics |
| Identity | Keycloak metrics | HTTP, JVM, cache and authentication metrics |
| Object storage | MinIO metrics | storage and request metrics |

## Correlation model

Every inbound request gets or preserves `x-request-id` and W3C `traceparent`. Services log `traceId` and `spanId` and forward correlation identifiers to internal calls and asynchronous messages.

## What must be measurable

For every service: request count/rate, status distribution, p50/p95/p99 latency, in-flight requests, error rate, CPU, memory, event-loop delay, active resources, outbound dependency latency/errors, database pool state, database query latency/errors, background job latency/errors and Kafka consumer lag where applicable.

For each important business operation, add a domain span around the atomic operation rather than relying only on the outer HTTP span.

## Logs

Logs are JSON and contain timestamp, level, service, event, requestId, traceId/spanId and duration/outcome where applicable. Secrets, authorization headers, passwords, tokens and sensitive user data are redacted. High-cardinality values must not become Prometheus labels.

## Investigation workflow

1. Take `x-request-id` or `traceId` from the client response/log.
2. Search the request in Grafana/Loki.
3. Open the matching trace in Grafana/Tempo.
4. Follow Gateway -> service -> outbound service spans.
5. Compare span duration with Prometheus p95/p99 metrics.
6. If a database span is slow, inspect DB pool and exporter metrics.
7. If infrastructure is slow, inspect cAdvisor/exporter metrics.

This distinguishes application latency, downstream latency, database latency, queueing and infrastructure saturation instead of treating everything as one request duration.

## Local access

Grafana is served through the same NGINX entrypoint: `https://localhost:8443/grafana/`.

Prometheus, Loki, Tempo, databases and exporters remain internal to Docker and are not directly exposed to the host application surface.
