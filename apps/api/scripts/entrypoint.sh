#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node packages/db/dist/src/migrate.js
echo "[entrypoint] Migrations complete."

exec "$@"
