# PostgreSQL

`migrations/` contains ordered expand-contract migrations. `init/` contains only local bootstrap
hooks. Seeds are synthetic and idempotent; production data is never part of the repository.

## Migration commands

The runner is external to application startup and requires `DATABASE_URL` plus a local `psql`
binary:

```powershell
node infra/postgres/scripts/migrate.mjs status
node infra/postgres/scripts/migrate.mjs migrate
```

It acquires a PostgreSQL advisory lock, checks SHA-256 checksums, runs each pending migration in
its own transaction, records the migration, and releases the lock. Checksum drift fails closed.
No service replica runs migrations implicitly.
