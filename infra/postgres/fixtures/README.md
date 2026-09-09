# PostgreSQL integration fixtures

`002-integrity.sql` validates foreign keys, active-membership uniqueness, idempotent movement
keys, inbox/outbox deduplication, audit scope and family-filtered visibility against a disposable
PostgreSQL database.

Apply migrations and the synthetic seed first, then run the fixture:

```powershell
psql --no-psqlrc --dbname $env:DATABASE_URL --file infra/postgres/fixtures/002-integrity.sql
```

The fixture runs in one transaction and rolls back all rows. It must not be run against a database
containing user data.
