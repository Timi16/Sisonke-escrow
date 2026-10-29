#!/usr/bin/env bash
# Testnet proof of the timelocked, multisig upgrade (`make upgrade-demo`), on
# a separate, throwaway instance, never the real one:
#
#   1. a 2-of-3 multisig admin (scripts/multisig-admin.sh, NAME=sisonke-demo-admin)
#   2. deploy sisonke-escrow v1 as ALIAS=sisonke-upgrade-demo with a 60 s delay
#   3. create_and_fund one 1 USDC escrow (the deployer pays; it buys the USDC
#      on the Testnet DEX if it has none). It stays stranded there: see UPGRADES.md
#   4. propose the test-only fixture with ONE signer      → must fail on-chain
#   5. propose it with TWO signers (scripts/upgrade.sh)   → ok, starts the delay
#   6. execute before the eta                             → must fail on-chain
#   7. wait for the eta; execute with a wrong hash        → must fail on-chain
#   8. execute (scripts/upgrade.sh)                       → ok, then migrate (permissionless)
#   9. read version (2), the escrow, total_locked, the SAC balance; record every
#      transaction hash in the proof table in docs/UPGRADES.md
#
# Env: NETWORK (testnet), SOURCE (sisonke-deployer).
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-sisonke-deployer}"
ALIAS="sisonke-upgrade-demo"
ADMIN_NAME="sisonke-demo-admin"
DELAY=60
ENV_FILE="deployments/$NETWORK.$ALIAS.env"
FIXTURE="contracts/sisonke-escrow/testdata/upgrade_fixture.wasm"
AMOUNT=10000000 # 1 USDC
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { echo "✖ $*" >&2; exit 1; }

[ "$NETWORK" = "testnet" ] || die "The upgrade demo only runs on testnet."

step "2-of-3 multisig admin ($ADMIN_NAME)"
ADMIN="$(NETWORK="$NETWORK" NAME="$ADMIN_NAME" SIGNERS=3 THRESHOLD=2 ./scripts/multisig-admin.sh)"
echo "admin: $ADMIN"

step "Deploy v1 as $ALIAS (upgrade delay $DELAY s)"
# FORCE=1 only ever replaces this demo's own env file, never deployments/testnet.env.
NETWORK="$NETWORK" SOURCE="$SOURCE" ALIAS="$ALIAS" ENV_FILE="$ENV_FILE" ADMIN="$ADMIN" \
  UPGRADE_DELAY="$DELAY" FORCE=1 ./scripts/deploy.sh
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

[ "$DEMO_ID" != "$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "deployments/$NETWORK.env" 2>/dev/null | cut -d= -f2)" ] ||
  die "The demo id is the main deployment; refusing to install the fixture on it."
[ -d scripts/node_modules ] || npm ci --prefix scripts --silent
FIXTURE_HASH="$(shasum -a 256 "$FIXTURE" | cut -d' ' -f1)"
ONE="$ADMIN_NAME-signer-1"
TWO="$ADMIN_NAME-signer-1,$ADMIN_NAME-signer-2"
admin_ts() { node scripts/admin.ts "$@" --contract "$DEMO_ID" --fee-payer "$SOURCE" --env-file "$ENV_FILE"; }
json_field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" <<<"$2"; }
status_of() { admin_ts status | sed -n "s/^$1=//p"; }
ROWS=()
row() { # step, signers, expected, result, hash
  local link="n/a"
  [ -n "$5" ] && link="[\`${5:0:8}…\`]($NEXT_PUBLIC_EXPLORER_URL/tx/$5)"
  ROWS+=("| $1 | $2 | $3 | $4 | $link |")
  echo "$1: $4 ${5:-}"
}

step "Upload the fixture"
UPLOADED="$(stellar contract upload --wasm "$FIXTURE" --source "$SOURCE" --network "$NETWORK")"
[ "$UPLOADED" = "$FIXTURE_HASH" ] || die "Uploaded hash $UPLOADED differs from $FIXTURE_HASH"

step "Propose with one signer (must fail on-chain)"
OUT="$(admin_ts propose "$FIXTURE_HASH" --signers "$ONE" --expect-failure)" ||
  die "A 1-of-3 proposal was not refused on-chain: $OUT"
ERR="$(json_field error "$OUT")"
[[ "$ERR" == *"#5 "* || "$ERR" == Auth* ]] || die "Refused for the wrong reason: $ERR"
row "propose_upgrade, 1 signer" "1 of 3" "refused: signer weight below threshold" "⛔ $ERR" "$(json_field hash "$OUT")"
[ -z "$(status_of pending_hash)" ] || die "A proposal is pending after the refused call"

step "Propose with two signers"
OUT="$(WASM="$FIXTURE" ALLOW_FIXTURE=1 YES=1 ADMIN_NAME="$ADMIN_NAME" ADMIN_SIGNERS="$TWO" \
  NETWORK="$NETWORK" SOURCE="$SOURCE" ENV_FILE="$ENV_FILE" ./scripts/upgrade.sh propose "$DEMO_ID" | tail -1)"
ETA="$(status_of pending_eta)"
row "propose_upgrade, 2 signers" "2 of 3" "ok, eta = now + ${DELAY} s" "✅ eta $ETA" "$(json_field hash "$OUT")"

step "Execute before the eta (must fail on-chain)"
OUT="$(admin_ts execute --signers "$TWO" --expect-failure)" ||
  die "An early upgrade was not refused on-chain: $OUT"
ERR="$(json_field error "$OUT")"
[[ "$ERR" == *"#204"* ]] || die "Refused for the wrong reason: $ERR"
row "upgrade before eta" "2 of 3" "refused: UpgradeTooEarly (204)" "⛔ $ERR" "$(json_field hash "$OUT")"

step "Wait for the eta ($ETA)"
while [ "$(status_of ledger_time)" -lt "$ETA" ]; do
  printf '.'
  sleep 5
done
echo

step "Execute with the wrong expected hash (must fail on-chain)"
# Every signature on upgrade() commits to one hash; any other is refused.
WRONG="$(printf '0%.0s' $(seq 1 64))"
OUT="$(admin_ts execute --signers "$TWO" --expected "$WRONG" --expect-failure)" ||
  die "An upgrade with the wrong hash was not refused on-chain: $OUT"
ERR="$(json_field error "$OUT")"
[[ "$ERR" == *"#206"* ]] || die "Refused for the wrong reason: $ERR"
row "upgrade(wrong hash) after eta" "2 of 3" "refused: UpgradeHashMismatch (206)" "⛔ $ERR" "$(json_field hash "$OUT")"

step "Execute and migrate"
OUT="$(YES=1 MIGRATE=1 ADMIN_NAME="$ADMIN_NAME" ADMIN_SIGNERS="$TWO" NETWORK="$NETWORK" \
  SOURCE="$SOURCE" ENV_FILE="$ENV_FILE" ./scripts/upgrade.sh execute "$DEMO_ID" | tail -1)"
row "upgrade at eta (+ migrate)" "2 of 3" "ok, version 2, storage 2" "✅ upgraded" "$(json_field hash "$OUT")"

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
DATE="$(date -u +%Y-%m-%d)"
BLOCK="$(
  echo "**$DATE**: demo contract [\`$DEMO_ID\`]($NEXT_PUBLIC_EXPLORER_URL/contract/$DEMO_ID), admin [\`$ADMIN\`]($NEXT_PUBLIC_EXPLORER_URL/account/$ADMIN) (2-of-3), delay $DELAY s, v1 wasm \`$V1_HASH\`, fixture wasm \`$FIXTURE_HASH\`, escrow #$ESCROW_ID: total_locked $LOCKED_BEFORE → $LOCKED_AFTER, contract USDC $SAC_BALANCE, version / storage $VERSION / $STORAGE."
  echo
  echo "| Step | Signers | Expected | Result | Transaction |"
  echo "|---|---|---|---|---|"
  printf '%s\n' "${ROWS[@]}"
)"
tmp="$(mktemp)"
# Each run's block goes just above the marker.
BLOCK="$BLOCK" awk '/<!-- upgrade-demo rows -->/ { print ENVIRON["BLOCK"]; print "" } { print }' docs/UPGRADES.md >"$tmp"
mv "$tmp" docs/UPGRADES.md
echo "$BLOCK"
