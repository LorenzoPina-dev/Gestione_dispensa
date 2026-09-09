# PostgreSQL

`migrations/` contains ordered expand-contract migrations. `init/` contains only local bootstrap
hooks. Seeds are synthetic and idempotent; production data is never part of the repository.
