# Integration worker

Provider adapter worker for external capabilities that are intentionally asynchronous.

## Current responsibilities

- receipt/OCR provider adapters;
- recognition adapters;
- external offers/provider integrations when enabled;
- recipe/nutrition provider adapters when enabled.

Barcode lookup is owned by `service-catalog` through `off-lookup`; it is not implemented as a
hidden catalog domain inside this worker.

Each provider is isolated behind an adapter. Automatic results must remain attributable to a
source and, where the product contract requires it, reviewable before becoming authoritative data.

The worker exposes only operational health endpoints and consumes its configured queues/jobs.
It does not own transactional domain tables.

## Repository hygiene

Legacy barcode/catalog implementation is no longer retained in this service. Historical source
files under `_deprecated/` were removed from the repository; the dedicated `service-catalog` and
`off-lookup` services are the only owners of barcode/catalog behavior.
