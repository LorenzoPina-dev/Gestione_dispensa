# Network architecture

Networks:

- `edge`: NGINX and web
- `backend`: NGINX, gateway and domain services
- `data`: internal-only databases and storage
- `messaging`: internal-only Kafka/event infrastructure

Only NGINX exposes a host port (`8443`). Database, Kafka, Redis, MongoDB, MinIO and OpenSearch ports are not public application endpoints.

Internal service discovery uses Docker DNS, e.g. `http://inventory:3016`.

The intended LAN entrypoint is `https://<host>:8443`. Direct Vite access is a development fallback, not the application entrypoint.
