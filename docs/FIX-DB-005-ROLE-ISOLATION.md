# FIX-DB-005 — PostgreSQL role isolation

## Goal
Remove `app.service=true` as an RLS trust boundary. A mutable session GUC must never decide whether a request bypasses tenant isolation.

## Roles
- `dispensa_app`: HTTP/API services; `NOBYPASSRLS`.
- `dispensa_worker`: trusted background workers; `BYPASSRLS`.
- `POSTGRES_USER`: bootstrap/migration administrator only.

## Runtime
HTTP services use `dispensa_app`; cross-family background workers use `dispensa_worker`. `app_is_service()` is retained only for compatibility and always returns false.

## Tenant context
HTTP services propagate the selected family as `X-Family-Id` into transaction-local `app.family_id`. The header is a context hint, not an authorization credential: membership/authorization checks remain mandatory in the service layer.

## Deployment
The role bootstrap runs only for a new PostgreSQL data directory. Existing installations must create/rotate the two roles before switching containers to the new connection strings.

## Validation
- migration suite: 9/9 passing
- compose YAML parse: passing
- live PostgreSQL role/RLS verification: pending
