#!/usr/bin/env bash
# Testnet upgrade proof (`make upgrade-demo`), on a separate, throwaway
# instance, never the real one:
#
#   1. deploy sisonke-escrow v1 as ALIAS=sisonke-upgrade-demo
#   2. create_and_fund one 1 USDC escrow (the deployer pays; it buys the USDC
#      on the Testnet DEX if it has none)
#   3. upgrade to the test-only fixture wasm and run its migrate (MIGRATE=1)
#   4. read version (2), the escrow, total_locked and the SAC balance
#   5. add a row to the proof table in docs/UPGRADES.md
#
# Env: NETWORK (testnet), SOURCE (sisonke-deployer).
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-sisonke-deployer}"
ALIAS="sisonke-upgrade-demo"
ENV_FILE="deployments/$NETWORK.$ALIAS.env"
FIXTURE="contracts/sisonke-escrow/testdata/upgrade_fixture.wasm"
AMOUNT=10000000 # 1 USDC
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { echo "✖ $*" >&2; exit 1; }

[ "$NETWORK" = "testnet" ] || die "The upgrade demo only runs on testnet."

step "Deploy v1 as $ALIAS"
# FORCE=1 only ever replaces this demo's own env file, never deployments/testnet.env.
NETWORK="$NETWORK" SOURCE="$SOURCE" ALIAS="$ALIAS" ENV_FILE="$ENV_FILE" FORCE=1 ./scripts/deploy.sh
# shellcheck disable=SC1090
set -a && . "$ENV_FILE" && set +a
DEMO_ID="$NEXT_PUBLIC_SISONKE_CONTRACT_ID"
V1_HASH="$SISONKE_WASM_HASH"
PAYER="$(stellar keys address "$SOURCE")"

view() {
  stellar contract invoke --id "$1" --source "$SOURCE" --network "$NETWORK" --send=no -- "${@:2}"
}

step "USDC for the payer ($SOURCE)"
if ! view "$NEXT_PUBLIC_USDC_SAC_ID" balance --id "$PAYER" >/dev/null 2>&1; then
  stellar tx new change-trust --source "$SOURCE" --network "$NETWORK" \
    --line "USDC:$NEXT_PUBLIC_USDC_ISSUER" >/dev/null
  echo "✓ USDC trustline added"
fi
BALANCE="$(view "$NEXT_PUBLIC_USDC_SAC_ID" balance --id "$PAYER" | tr -d '"')"
[[ "$BALANCE" =~ ^[0-9]+$ ]] || die "Could not read the payer's USDC balance (got '$BALANCE')"
if [ "$BALANCE" -lt "$AMOUNT" ]; then
  # Buy exactly 2 USDC with at most 100 XLM on the Testnet DEX.
  stellar tx new path-payment-strict-receive --source "$SOURCE" --network "$NETWORK" \
    --send-asset native --send-max 1000000000 \
    --destination "$PAYER" --dest-asset "USDC:$NEXT_PUBLIC_USDC_ISSUER" \
    --dest-amount 20000000 >/dev/null ||
    die "No XLM→USDC path on the DEX. Get Testnet USDC at https://faucet.circle.com for $PAYER"
  echo "✓ bought 2 USDC with XLM"
fi

step "create_and_fund 1 USDC"
RECIPIENT_KEY="sisonke-demo-recipient"
stellar keys address "$RECIPIENT_KEY" >/dev/null 2>&1 ||
  stellar keys generate "$RECIPIENT_KEY" --network "$NETWORK" --fund >/dev/null
RECIPIENT="$(stellar keys address "$RECIPIENT_KEY")"
DEADLINE=$(($(date +%s) + 86400))
ESCROW_ID="$(
  stellar contract invoke --id "$DEMO_ID" --source "$SOURCE" --network "$NETWORK" -- \
    create_and_fund --payer "$PAYER" --recipient "$RECIPIENT" \
    --amount "$AMOUNT" --deadline "$DEADLINE" --title "upgrade demo" | tr -d '"'
)"
LOCKED_BEFORE="$(view "$DEMO_ID" total_locked | tr -d '"')"
echo "escrow #$ESCROW_ID, total_locked $LOCKED_BEFORE"

step "Upgrade to the fixture and migrate"
[ "$DEMO_ID" != "$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "deployments/$NETWORK.env" 2>/dev/null | cut -d= -f2)" ] ||
  die "The demo id is the main deployment; refusing to install the fixture on it."
# The fixture is allowed only here, on this throwaway instance.
WASM="$FIXTURE" MIGRATE=1 ALLOW_FIXTURE=1 YES=1 NETWORK="$NETWORK" SOURCE="$SOURCE" ENV_FILE="$ENV_FILE" \
  ./scripts/upgrade.sh "$DEMO_ID"
FIXTURE_HASH="$(shasum -a 256 "$FIXTURE" | cut -d' ' -f1)"

step "After"
VERSION="$(view "$DEMO_ID" version)"
STORAGE="$(view "$DEMO_ID" storage_version)"
LOCKED_AFTER="$(view "$DEMO_ID" total_locked | tr -d '"')"
SAC_BALANCE="$(view "$NEXT_PUBLIC_USDC_SAC_ID" balance --id "$DEMO_ID" | tr -d '"')"
[[ "$SAC_BALANCE" =~ ^[0-9]+$ ]] || die "Could not read the contract's USDC balance (got '$SAC_BALANCE')"
echo "version:         $VERSION"
echo "storage_version: $STORAGE"
echo "escrow:          $(view "$DEMO_ID" get_escrow --id "$ESCROW_ID")"
echo "total_locked:    $LOCKED_BEFORE → $LOCKED_AFTER"
echo "SAC balance:     $SAC_BALANCE"
[ "$VERSION" = "2" ] || die "expected version 2 after the upgrade"
[ "$LOCKED_AFTER" = "$LOCKED_BEFORE" ] || die "total_locked changed across the upgrade"
[ "$SAC_BALANCE" -ge "$LOCKED_AFTER" ] || die "SAC balance below total_locked"

step "Record in docs/UPGRADES.md"
ROW="| $(date -u +%Y-%m-%d) | [\`$DEMO_ID\`]($NEXT_PUBLIC_EXPLORER_URL/contract/$DEMO_ID) | \`$V1_HASH\` | \`$FIXTURE_HASH\` | #$ESCROW_ID | $LOCKED_BEFORE → $LOCKED_AFTER | $SAC_BALANCE | $VERSION / $STORAGE |"
tmp="$(mktemp)"
# Rows go just above the marker, so they stay part of the table.
awk -v row="$ROW" '/<!-- upgrade-demo rows -->/ { print row } { print }' docs/UPGRADES.md >"$tmp"
mv "$tmp" docs/UPGRADES.md
echo "$ROW"
