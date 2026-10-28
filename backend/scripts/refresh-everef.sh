#!/bin/sh
#
# Maintenance script for refresh everef.
# Reads environment or downloaded EVE data and writes database/import artifacts when run manually.
#

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
TARGET_DIR="$ROOT_DIR/routes/data/everef"

mkdir -p "$TARGET_DIR"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[everef] target dir: $TARGET_DIR"

REF_URL="https://data.everef.net/reference-data/reference-data-latest.tar.xz"
echo "[everef] downloading reference data..."
curl -fsSL "$REF_URL" -o "$TMP_DIR/refdata.tar.xz"

echo "[everef] decompressing reference data..."
xz -d "$TMP_DIR/refdata.tar.xz"
REF_TAR="$TMP_DIR/refdata.tar"

echo "[everef] extracting reference data..."
tar -xf "$REF_TAR" -C "$TMP_DIR"

BP_SRC=$(find "$TMP_DIR" -maxdepth 6 -type f -name 'blueprints.json' | head -n 1 || true)
TYPES_SRC=$(find "$TMP_DIR" -maxdepth 6 -type f -name 'types.json' | head -n 1 || true)

if [ -z "$BP_SRC" ] || [ -z "$TYPES_SRC" ]; then
  echo "[everef] ERROR: blueprints.json or types.json not found in bundle"
  exit 1
fi

cp "$BP_SRC" "$TARGET_DIR/blueprints.json"
cp "$TYPES_SRC" "$TARGET_DIR/types.json"
echo "[everef] wrote $TARGET_DIR/blueprints.json"
echo "[everef] wrote $TARGET_DIR/types.json"

MP_URL="https://data.everef.net/markets-prices/markets-prices-latest.json"
echo "[everef] downloading markets-prices..."
curl -fsSL "$MP_URL" -o "$TMP_DIR/markets-prices.json"

jq '
  map(select(.adjusted_price != null))
  | map({ type_id, adjusted_price })
' "$TMP_DIR/markets-prices.json" > "$TARGET_DIR/adjusted_prices.json"
echo "[everef] wrote $TARGET_DIR/adjusted_prices.json"

jq '
  map({ type_id, average_price })
' "$TMP_DIR/markets-prices.json" > "$TARGET_DIR/market_prices.json"
echo "[everef] wrote $TARGET_DIR/market_prices.json"

echo "[everef] refresh complete."
