#!/bin/bash
set -euo pipefail

APP_PASSWORD="${POSTGRES_APP_PASSWORD:-change-me-app-local-only}"
SQL_PASSWORD=$(printf '%s' "$APP_PASSWORD" | sed "s/'/''/g")

for role in identity_app family_app inventory_app shopping_app catalog_app notifications_app privacy_app jobs_app recipes_app nutrition_app stores_app shelf_life_app ocr_app; do
  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$role'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "ALTER ROLE \"$role\" LOGIN PASSWORD '$SQL_PASSWORD';"
  else
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE ROLE \"$role\" LOGIN PASSWORD '$SQL_PASSWORD';"
  fi
done
