# Keycloak local identity

`realm-dispensa.json` is an importable local realm with public PKCE web client, bearer-only API
client, audience mapping, and application roles. Administrator credentials are injected through
Compose variables and are never stored in the export.

The redirect URI is intentionally limited to localhost for the local profile. Production uses a
separate realm/client configuration with managed secrets, TLS, approved origins, and rotation.
