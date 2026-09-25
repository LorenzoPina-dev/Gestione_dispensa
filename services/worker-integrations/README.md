# Integration worker

Isolated consumer for OCR, recipes, nutrition, and offers providers. Every provider is an
adapter and every automatic result remains reviewable.

Barcode/catalog resolution used to live here but was removed: `apps/api` talks to the
`off-lookup` microservice directly (see `apps/api/src/catalog/external-barcode-client.ts`).
The removed code is kept for reference in `_deprecated/` until it's dropped for good — see
`_deprecated/README.md`.

`offers`, `recipes-nutrition`, and `recognition` are kept as-is for now; they are expected to be
replaced by dedicated microservices later, the same way barcode resolution was replaced by
`off-lookup`. None of them is wired into `src/server.ts` yet (it only serves health checks).
