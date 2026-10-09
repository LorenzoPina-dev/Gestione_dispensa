# PostgreSQL role and RLS review

This review is based on the current service code and migration/bootstrap SQL. It records the scope to close before changing persistent policies or database ownership.

## Findings

- Most services separate the runtime `*_app` login from a service migration login. Compose supplies migration credentials directly, and those accounts own their service databases and relay outbox tables.
- Food Semantics is an exception: the service, schema migration, and ontology bootstrap all use `food_semantics_app`; the bootstrap role also owns `food_semantics_db`. This combines runtime access with schema and data-loading privileges.
- The Identity security migration enables RLS on `users`, `idempotency_keys`, and `outbox_events`, but the policies allow rows when `app.user_id` is an empty string. The context-aware pool sets empty values when no request context exists, so this is fail-open for the app role.
- The Identity HTTP handler checks the authenticated user ID before profile and preference routes. Its public register/reset/logout routes do not query these three tables. The internal dietary-preference route queries a separate table after checking the internal service token.
- Identity's relay connects as the owning `identity` role. RLS is enabled but not forced, so the table owner can still relay rows. A fail-closed policy on the three app-facing tables should not constrain that relay, but the migration path and integration behavior still need a database-backed check.

## Next safe database verification

Before applying a fail-closed Identity migration, run an integration check against PostgreSQL that proves:

1. An authenticated user can read and update only their own profile and idempotency rows.
2. A missing user context reads no rows and cannot insert or update those rows.
3. A second user's context cannot read or alter the first user's rows.
4. Public registration, password reset, and logout remain independent of these tables.
5. The Identity relay can still publish user outbox rows under its migration role.

Then apply the policy change as a new migration; do not edit the already-applied `999_security.sql`.

Food Semantics should be split into a migration/owner role and a runtime role in a separate change. The service can receive only the schema/table privileges it needs; migrations and ontology bootstrap should not share the runtime login.
