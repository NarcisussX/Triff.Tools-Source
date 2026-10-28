#!/usr/bin/env bash
#
# Maintenance script for bootstrap everef data.
# Reads environment or downloaded EVE data and writes database/import artifacts when run manually.
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/backend/routes/data/everef"

mkdir -p "$TARGET_DIR"

echo "[everef bootstrap] Using target dir: $TARGET_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[everef bootstrap] Downloading reference-data-latest.tar.xz ..."
curl -fsSL "https://data.everef.net/reference-data/reference-data-latest.tar.xz" -o "$TMP_DIR/refdata.tar.xz"

echo "[everef bootstrap] Extracting reference data ..."
tar -xJf "$TMP_DIR/refdata.tar.xz" -C "$TMP_DIR"

BP_SRC="$(find "$TMP_DIR" -maxdepth 5 -type f -name 'blueprints.json' | head -n1 || true)"
if [[ -z "$BP_SRC" ]]; then
  echo "[everef bootstrap] ERROR: Could not find blueprints.json inside reference data."
  exit 1
fi
cp "$BP_SRC" "$TARGET_DIR/blueprints.json"
echo "[everef bootstrap] Wrote $TARGET_DIR/blueprints.json"

TYPES_SRC="$(find "$TMP_DIR" -maxdepth 5 -type f -name 'types.json' | head -n1 || true)"
if [[ -z "$TYPES_SRC" ]]; then
  echo "[everef bootstrap] ERROR: Could not find types.json inside reference data."
  exit 1
fi
cp "$TYPES_SRC" "$TARGET_DIR/types.json"
echo "[everef bootstrap] Wrote $TARGET_DIR/types.json"

echo "[everef bootstrap] Downloading markets-prices-latest.json ..."
curl -fsSL "https://data.everef.net/markets-prices/markets-prices-latest.json" -o "$TMP_DIR/markets-prices-latest.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "[everef bootstrap] ERROR: jq is required to build price files."
  exit 1
fi

jq '
  map(select(.adjusted_price != null))
  | map({ type_id, adjusted_price })
' "$TMP_DIR/markets-prices-latest.json" > "$TARGET_DIR/adjusted_prices.json"
echo "[everef bootstrap] Wrote $TARGET_DIR/adjusted_prices.json"

jq '
  map(
    {
      type_id,
      average_price: (
        .average_price
        // .five_percent_sell
        // .five_percent_buy
        // 0
      )
    }
  )
' "$TMP_DIR/markets-prices-latest.json" > "$TARGET_DIR/market_prices.json"
echo "[everef bootstrap] Wrote $TARGET_DIR/market_prices.json"

echo "[everef bootstrap] Done."
