# Gateway / BFF

Browser-facing API boundary.

- Container port: `3300`
- Data ownership: none
- Public entry: Nginx `/api/v1/*`

## Responsibilities

- verify JWT issuer/audience/signature;
- route requests to owning services;
- propagate authorization and request metadata;
- normalize upstream failures;
- aggregate Composite Views.

The Gateway does not own domain persistence and must not contain domain business rules.
