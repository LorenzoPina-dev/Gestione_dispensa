# Diagnostica end-to-end dell'accesso al DB con lo STESSO utente/password/RLS dei servizi.
# Uso (dalla root del repo):  powershell -ExecutionPolicy Bypass -File tools\diagnose-db.ps1
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)

$appPassword = if ($env:POSTGRES_APP_PASSWORD) { $env:POSTGRES_APP_PASSWORD } else { "change-me-app-local-only" }
$dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "dispensa" }

Write-Host "`n##### A. Ruoli nel database (rolcanlogin DEVE essere true per dispensa_app) #####" -ForegroundColor Cyan
docker compose exec -T postgres psql -U dispensa -d $dbName -c "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname like 'dispensa%' order by 1;" 2>&1 | Where-Object { $_ -notmatch "LAN_HOST" }

Write-Host "`n##### B. Migrazioni applicate (ultime 6) #####" -ForegroundColor Cyan
docker compose exec -T postgres psql -U dispensa -d $dbName -c "select version, name from schema_migrations order by version desc limit 6;" 2>&1 | Where-Object { $_ -notmatch "LAN_HOST" }

Write-Host "`n##### C. Login come dispensa_app via TCP (stessa password dei servizi) + query simulate #####" -ForegroundColor Cyan
Get-Content -Raw "tools\diagnose-db.sql" |
  docker compose exec -T -e "PGPASSWORD=$appPassword" postgres psql -h postgres -U dispensa_app -d $dbName -f - 2>&1 |
  Where-Object { $_ -notmatch "LAN_HOST" }

Write-Host "`n##### D. Errori recenti nei log dei servizi #####" -ForegroundColor Cyan
docker compose logs --tail 300 service-identity service-family 2>&1 |
  Select-String -Pattern "failed|error|violates|denied|does not exist|authentication|not permitted" |
  Where-Object { $_ -notmatch "LAN_HOST" } | Select-Object -Last 25
