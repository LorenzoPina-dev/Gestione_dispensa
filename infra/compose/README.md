# Compose environments

The repository uses explicit Compose profiles. The maintained family-local runtime starts the web edge, Gateway, domain services, PostgreSQL, Redis, Keycloak and the configured workers/storage dependencies.

Profiles are used to keep optional infrastructure explicit rather than hiding dependencies inside application processes.

The public application entry remains Nginx. Internal service ports are Docker-network addresses and are not browser contracts.
