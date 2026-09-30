# Implementation roadmap

This reset establishes the target architecture and removes the legacy backend tree. It intentionally does not pretend that every business endpoint is already implemented.

## Phase 0 — architecture baseline

- [x] preserve web UI
- [x] isolate services by bounded context
- [x] independent Docker build contexts
- [x] gateway/network baseline
- [x] data-platform baseline
- [x] domain/API/event documentation

## Phase 1 — foundation

- [ ] production Keycloak realm/client configuration
- [ ] gateway routing and OIDC validation
- [ ] users/families persistence
- [ ] invitation lifecycle
- [ ] service-to-service authentication

## Phase 2 — product and pantry

- [ ] product model
- [ ] OFF MongoDB hot-start import
- [ ] barcode lookup/cache
- [ ] inventory CRUD/consume/waste/move
- [ ] inventory events

## Phase 3 — vision and expiration

- [ ] image upload to MinIO
- [ ] barcode-from-image
- [ ] OCR
- [ ] receipt parsing
- [ ] expiration rules and prediction API

## Phase 4 — shopping and offers

- [ ] shopping lists
- [ ] automatic restock events
- [ ] stores
- [ ] offers ingestion/normalization
- [ ] product/offer matching

## Phase 5 — intelligence/platform

- [ ] recipes/pantry matching
- [ ] nutrition
- [ ] notifications
- [ ] search projection
- [ ] analytics

No phase may reintroduce shared database access or a monolithic backend.
