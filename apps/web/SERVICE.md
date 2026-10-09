# Web UI service

The React/Vite SPA is built into an isolated Nginx container and is reachable only through the platform Nginx reverse proxy.

Browser traffic:
- `/` -> `web` container
- `/api/v1/*` -> `gateway`
- `/realms/*` -> Keycloak

The browser never addresses a domain service directly. Composite screen views use one request per screen; mutations use the same `/api/v1` gateway boundary.
