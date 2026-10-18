# PostgreSQL role and RLS review

This review is based on the service code and migration/bootstrap SQL. It records the remaining role hardening and the verification for the Identity policy change.

## Findings

- Most services separate the runtime `*_app` login from a service migration login. Compose supplies migration credentials directly, and those accounts own their service databases and relay outbox tables.
- Food Semantics is an exception: the service, schema migration, and ontology bootstrap all use `food_semantics_app`; the bootstrap role also owns `food_semantics_db`. This combines runtime access with schema and data-loading privileges.
- The legacy Identity `999_security.sql` policies allowed broad access when `app.user_id` was empty. The new `1000_rls_fail_closed.sql` replaces that behavior for `users`, `idempotency_keys`, and `outbox_events`; missing context now matches no rows.
- The Identity handler checks the authenticated user ID before profile and preference routes. Its public register/reset/logout routes do not query these three tables. The internal dietary-preference route queries a separate table after checking the internal service token.
- Identity's relay connects as the owning `identity` role. RLS is enabled but not forced, so the owner can still read and relay rows. The PostgreSQL integration proof checks this alongside app-role isolation.

## Verified Identity policy behavior

The rollback-only PostgreSQL proof passed in CI against PostgreSQL 16. It checked:

1. Missing context reads no profile, idempotency, or outbox rows and cannot insert a profile.
2. A user context sees and updates its own profile; reads and writes to another profile return no rows.
3. The same context only sees its own idempotency and outbox rows.
4. The owning Identity relay role can read outbox rows.

The test applies the migration, then installs the same policies inside a rollback-only transaction, creates two test identities, performs the checks, and rolls the fixtures and temporary policy changes back. Public registration, password reset, and logout remain outside these table paths.

`999_security.sql` remains unchanged because it has already been applied in existing databases. The new `1000_rls_fail_closed.sql` replaces the permissive policies as an ordered migration.

Food Semantics should be split into a migration/owner role and a runtime role in a separate change. The service can receive only the schema/table privileges it needs; migrations and ontology bootstrap should not share the runtime login.

## Running the isolation proof

From the repository root in PowerShell:

```powershell
Get-Content services/service-identity/tests/rls-isolation.sql -Raw |
  docker compose exec -T postgres psql -U dispensa -d identity_db -v ON_ERROR_STOP=1
```

Run it after the service migrations. The final `ROLLBACK` removes all fixtures and restores the session's prior policy state.
