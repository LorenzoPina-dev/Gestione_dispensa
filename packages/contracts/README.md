# Contracts

Versioned OpenAPI, JSON Schema events, job payloads, error envelopes, and compatibility rules.
This package is the only shared source for cross-service wire contracts.

The canonical HTTP specification is [docs/openapi.yaml](../../docs/openapi.yaml). The package
exports stable envelope, job, header, and route metadata types from `src/index.ts`. Operation-
specific request and response types are added with their owning domain contract and must not be
replaced by untyped payloads in service code.
