# API contract

External API version: `/api/v1`.

Gateway responsibilities: routing, authentication context propagation, request IDs, rate limiting and bounded aggregation. It contains no domain business logic.

Planned endpoint groups:

- `/auth/*`
- `/users/*`
- `/families/*` including invitations
- `/products/*`
- `/barcodes/*`
- `/vision/*`
- `/inventory/*`
- `/expiration/*`
- `/shopping/*`
- `/stores/*`
- `/offers/*`
- `/recipes/*`
- `/nutrition/*`
- `/notifications/*`
- `/media/*`
- `/search/*`
- `/analytics/*`

Every service also exposes `/health/live` and `/health/ready`.

Compatibility with the existing web UI must be implemented at the gateway/domain boundary; UI code is preserved during the reset rather than silently changed to match a broken backend.
