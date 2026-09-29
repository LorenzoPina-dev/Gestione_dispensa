# FIX-DB-003 — Tenant DB context

## Scope

Establishes the PostgreSQL session context required by the tenant-isolation RLS layer.

## Request path

1. OIDC verifies the JWT.
2. `resolvePrincipal()` stores the verified `subject` in request-local `AsyncLocalStorage`.
3. `PostgresClient` applies `app.user_id` with `SET LOCAL` inside every transaction and with a transaction-local setting for standalone queries.
4. PostgreSQL RLS evaluates the authenticated user against `family_memberships`.

## Service path

Trusted background workers explicitly set `app.service=true` on their database connection/transaction. This bypass is deliberately restricted to worker runtimes and must never be enabled from HTTP request data.

## Security invariant

`family_id` is not trusted from the client as an authorization credential. RLS derives visibility from the authenticated OIDC subject and the membership graph.

## Verification

Local/live PostgreSQL verification remains pending because the developer cannot execute the environment currently. The existing `ops/rls.test.mjs` remains the required cross-family read/write test.
