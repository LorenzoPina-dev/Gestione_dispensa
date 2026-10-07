#!/bin/bash
set -euo pipefail

APP_PASSWORD="${POSTGRES_APP_PASSWORD:-change-me-app-local-only}"

for role in identity_app family_app inventory_app shopping_app catalog_app notifications_app privacy_app jobs_app recipes_app nutrition_app stores_app shelf_life_app ocr_app; do
  if ! psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$role'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v role_name="$role" -v role_password="$APP_PASSWORD" -c 'SELECT format(''CREATE ROLE %I LOGIN PASSWORD %L'', :'role_name', :'role_password') \gexec'
  else
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v role_name="$role" -v role_password="$APP_PASSWORD" -c 'ALTER ROLE :"role_name" PASSWORD :'role_password''
  fi
done
