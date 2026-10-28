#!/bin/sh
#
# Maintenance script for import SDE.
# Reads environment or downloaded EVE data and writes database/import artifacts when run manually.
#

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "importSDE: DATABASE_URL not set"
  exit 1
fi

echo "importSDE: starting YAML SDE import/update…"
node --max-old-space-size="${SDE_IMPORT_MAX_OLD_SPACE_MB:-4096}" ./backend/scripts/importSDEFromYaml.js
echo "importSDE: done."
