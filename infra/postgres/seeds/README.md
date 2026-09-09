# Synthetic PostgreSQL seeds

The files in this directory contain deterministic, non-personal fixtures for the family-local
profile. They are never applied by an application replica and are not part of the migration
history.

Apply them explicitly after migrations:

```powershell
psql --no-psqlrc --dbname $env:DATABASE_URL --file infra/postgres/seeds/001_family-local.sql
```

The fixture uses reserved all-zero UUID prefixes and is idempotent. It is suitable for local
smoke tests only; production data must never be committed to this directory.
