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

The current executable foundation contains API, PostgreSQL, and Redis. Gateway, worker-core, and
scheduler remain separate deployables in the repository and are enabled only after their process
implementations and health contracts land; this prevents a healthy Compose profile from hiding
non-functional placeholder containers. The resource limits above reserve the database and keep
local failure contained to the lowest-priority process first.
