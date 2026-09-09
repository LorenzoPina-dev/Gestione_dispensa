# Compose environments

The root `docker-compose.yml` includes the maintained `family-local` definition from this
directory. Additional capabilities are added as explicit Compose profiles, never as hidden
runtime dependencies of the core.

Planned profile files:

- `family-local.yml`: local core foundation;
- `observability.yml`: Prometheus, Grafana, Alertmanager, OTel, Loki, and Tempo;
- `identity.yml`: local Keycloak realm;
- `storage.yml`: local MinIO buckets and policies;
- `optional.yml`: recognition, recipes, offers, and search capabilities.
