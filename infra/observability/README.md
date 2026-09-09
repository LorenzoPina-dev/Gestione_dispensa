# Observability provisioning

Versioned dashboards, recording rules, alert rules, OTel Collector configuration, Loki, and
Tempo provisioning belong here. Critical alerts must remain evaluable by Prometheus and
Alertmanager without Grafana.

The local stack uses `prometheus/prometheus.yml`, `prometheus/rules/core.yml`,
`alertmanager/alertmanager.yml`, `otel-collector/otel-collector.yml`, `loki/loki.yml`,
`tempo/tempo.yml`, and Grafana datasource provisioning. Retention is intentionally bounded for
the family-local profile; production retention and external receivers require a separate policy.
