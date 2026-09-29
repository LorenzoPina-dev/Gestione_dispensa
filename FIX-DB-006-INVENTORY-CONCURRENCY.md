# FIX-DB-006 — Inventory optimistic concurrency

## Problem

Inventory previously checked `If-Match` in the HTTP controller and then performed the movement in a separate repository transaction. Another writer could change the stock between those two operations.

## Fix

The client-observed `expectedVersion` is now carried into `recordMovementAtomic()` and checked after the stock row is locked with `FOR UPDATE`. A stale version raises `InventoryConflictError`, which is mapped to HTTP 409.

The idempotency lookup remains first: replaying an already committed operation returns the original result even if the current stock version has since advanced.

## Verification

`concurrency-contract.test.mjs` verifies the repository contract without requiring a live PostgreSQL instance.

Live concurrent-writer testing remains pending until the local environment is available.
