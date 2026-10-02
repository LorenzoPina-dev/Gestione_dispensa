#!/bin/sh
set -eu

MARKER=/tmp/service-inventory-migrations-complete

if [ ! -f "$MARKER" ]; then
  echo '{"service":"inventory","event":"migration.start"}'
  node dist/migrate.js
  touch "$MARKER"
  echo '{"service":"inventory","event":"migration.complete"}'
fi

exec node dist/server.js
