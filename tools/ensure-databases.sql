-- Idempotent repair for volumes created before infrastructure/postgres/init/00-databases.sql existed.
-- Creates missing roles/databases and re-aligns role passwords (role = <name>, password = <name>, db = <name>_db).
-- Never drops anything. Run with:
--   Get-Content tools\ensure-databases.sql | docker compose exec -T postgres psql -U dispensa -d postgres -v ON_ERROR_STOP=1

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'identity','family','inventory','shopping','catalog','notifications','privacy',
    'jobs','recipes','nutrition','stores','shelf_life','ocr'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', r, r);
    ELSE
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', r, r);
    END IF;
  END LOOP;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', r || '_db', r)
FROM unnest(ARRAY[
  'identity','family','inventory','shopping','catalog','notifications','privacy',
  'jobs','recipes','nutrition','stores','shelf_life','ocr'
]) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = r || '_db')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', r || '_db', r)
FROM unnest(ARRAY[
  'identity','family','inventory','shopping','catalog','notifications','privacy',
  'jobs','recipes','nutrition','stores','shelf_life','ocr'
]) AS r
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = r || '_db')
\gexec

SELECT datname AS database, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname LIKE '%\_db'
ORDER BY datname;
