# FIX-DB-004 — RLS policy hardening

## Changes

- Removed self-registration of `schema_migrations` from migration `0020`; the migration runner is the only owner of migration history.
- Added `app_current_family_id()` and made `app_family_visible()` compare the requested tenant to the transaction-local `app.family_id`.
- This removes recursive RLS evaluation through `family_memberships`, which could otherwise make policies recursively invoke themselves.
- `app.family_id` must be established by the authenticated request/worker context before tenant-scoped DB operations.

## Important security boundary

The database context is defense-in-depth against accidental cross-tenant access. The application must never copy an arbitrary client `family_id` into `app.family_id` before validating membership/authorization.

The existing `app.service` bypass remains a separate hardening item: it must be bound to a dedicated PostgreSQL worker role before production deployment. It is intentionally not marked production-complete by this fix.

## Verification

Static migration checks and policy inspection are required. Live PostgreSQL cross-tenant tests remain pending because no database test environment is available in the current execution context.
