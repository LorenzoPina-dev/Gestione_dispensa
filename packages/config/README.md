# Configuration

Typed configuration schemas, profile defaults, secret references, and startup validation shared
by deployable processes. Domain data never belongs in configuration.

`loadConfig()` validates the documented environment contract, rejects raw secret values, applies
local profile defaults, and returns a sanitized fingerprint. Services must call it before opening
listeners or consuming jobs; the returned config object must not be serialized to logs.
