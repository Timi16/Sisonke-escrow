#!/usr/bin/env bash
# Generates the TypeScript client for a deployed sisonke-escrow.
#
#   scripts/bindings.sh [CONTRACT_ID]
#
# CONTRACT_ID defaults to NEXT_PUBLIC_SISONKE_CONTRACT_ID in
# deployments/<network>.env. OUT_DIR (default: bindings/sisonke-escrow) is
# where the package is written; the web app phase will point it at its own
# folder. Not run by deploy.sh in this phase.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
OUT_DIR="${OUT_DIR:-bindings/sisonke-escrow}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTRACT_ID="${1:-}"
if [ -z "$CONTRACT_ID" ] && [ -f "deployments/$NETWORK.env" ]; then
  CONTRACT_ID="$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "deployments/$NETWORK.env" | cut -d= -f2)"
fi
[ -n "$CONTRACT_ID" ] || {
  echo "usage: scripts/bindings.sh <CONTRACT_ID>  (or run scripts/deploy.sh first)" >&2
  exit 1
}

# The JS SDK's generator (pinned in scripts/package.json) replaces the
# deprecated `stellar contract bindings typescript`.
[ -d scripts/node_modules ] || npm install --prefix scripts --silent
npx --prefix scripts stellar-js generate \
  --network "$NETWORK" \
  --contract-id "$CONTRACT_ID" \
  --contract-name sisonke-escrow \
  --output-dir "$OUT_DIR" \
  --overwrite

echo "Bindings written to $OUT_DIR for $CONTRACT_ID"
