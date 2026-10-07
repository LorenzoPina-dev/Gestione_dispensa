#!/bin/sh
set -eu

echo '{"service":"privacy","event":"migration.start"}'
node /app/dist/migrate.js
echo '{"service":"privacy","event":"migration.complete"}'

exec node /app/dist/server.js
