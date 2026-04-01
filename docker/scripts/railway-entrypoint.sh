#!/bin/sh
set -e

# Railway entrypoint script
# Runs as root. Uses su-exec to drop to omuser after fixing volume ownership.
# Uses /app/apps/mercato/storage (mounted volume) for both
# file attachments and the init marker to avoid needing two volumes.

STORAGE_DIR="/app/apps/mercato/storage"
MARKER_FILE="${STORAGE_DIR}/.initialized"

chown -R omuser:omuser "${STORAGE_DIR}"

if [ ! -f "${MARKER_FILE}" ]; then
  echo "First run: full initialization..."
  su-exec omuser yarn mercato init
  touch "${MARKER_FILE}"
else
  echo "Subsequent run: running migrations..."
  su-exec omuser yarn db:migrate
fi

exec su-exec omuser yarn start
