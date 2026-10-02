#!/bin/sh
set -eu

echo '{"service":"privacy","event":"migration.start"}'
node services/service-privacy/dist/migrate.js
echo '{"service":"privacy","event":"migration.complete"}'

exec node services/service-privacy/dist/server.js
