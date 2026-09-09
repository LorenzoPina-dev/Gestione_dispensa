# API service

The API owns synchronous application use cases and transaction boundaries. Identity verification
and authorization are separate modules: `src/identity/oidc.ts` validates the external principal,
while `src/identity/authorization.ts` applies family membership, role, status, resource-family,
and operator-scope policy. Every protected handler must call both boundaries and fail closed.
