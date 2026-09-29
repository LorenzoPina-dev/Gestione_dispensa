# FIX-DB-002 — Migration history integrity

## Status
Implemented and unit-tested.

## Problem found
The migration runner discovers files using `NNNN_name.sql`, but migrations 0018 and 0019 used `NNNN-name.sql`, so they were silently ignored. In addition, migrations 0017–0019 wrote their own `schema_migrations` records with legacy/non-canonical values, while the runner is supposed to be the sole owner of migration history.

## Changes
- Renamed 0018 and 0019 to the canonical `NNNN_name.sql` format.
- Added migration `0020_repair-migration-history.sql` to remove duplicate legacy history rows.
- Hardened the migration runner to accept only the known historical `manual` checksum marker for 0017–0019 and repair it to the real SHA-256 before continuing.
- Any other checksum mismatch remains a hard failure.
- Updated migration tests to cover the complete repository sequence through 0020.

## Verification
`node --test infra/postgres/scripts/migrate.test.mjs`

Result: **9/9 tests passed**.

## Pending local verification
A live PostgreSQL migration run is still pending because the user's Windows environment is currently unavailable for testing. It must be executed before marking database migration verification complete.
