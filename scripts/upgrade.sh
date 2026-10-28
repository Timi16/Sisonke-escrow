#!/usr/bin/env bash
# Upgrades a deployed sisonke-escrow in place, UUPS-style: the address,
# storage and locked funds stay the same, only the code changes.
#
#   scripts/upgrade.sh [CONTRACT_ID]                # build the current source and upgrade to it
#   WASM=path/to.wasm scripts/upgrade.sh            # upgrade to a specific wasm
#   WASM=path/to.wasm MIGRATE=1 scripts/upgrade.sh  # ...and run its migrate right after
#   WASM=old.wasm ROLLBACK=1 scripts/upgrade.sh     # rollback = upgrade to an older wasm
#
# Env:
#   NETWORK        testnet (default) or mainnet
#   SOURCE         sisonke-deployer; must be the contract admin
#   ENV_FILE       deployments/<network>.env; supplies the default CONTRACT_ID and
#                  gets SISONKE_WASM_HASH updated
#   MIGRATE=1      run migrate right after, if the new code has one pending
#   ROLLBACK=1     allow a lower version (and a lower storage version, which
#                  blocks escrow writes until upgraded forward again)
#   ALLOW_FIXTURE=1  allow the test-only upgrade fixture (upgrade-demo.sh only)
#   YES=1          skip the interactive confirmation
#
# Before anything is sent, the wasm is checked: it must export the functions
# every version keeps, its embedded version must go up, and its storage
# version must be the stored one or the next. Afterwards the on-chain code is
# fetched and its hash compared with the uploaded one.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-sisonke-deployer}"
MIGRATE="${MIGRATE:-}"
ROLLBACK="${ROLLBACK:-}"
ALLOW_FIXTURE="${ALLOW_FIXTURE:-}"
YES="${YES:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MAIN_ENV="deployments/$NETWORK.env"
ENV_FILE="${ENV_FILE:-$MAIN_ENV}"
FIXTURE="contracts/sisonke-escrow/testdata/upgrade_fixture.wasm"
FIXTURE_BUILD="target/wasm32v1-none/release/sisonke_upgrade_fixture.wasm"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { echo "✖ $*" >&2; exit 1; }
is_contract_id() { [[ "$1" =~ ^C[A-Z2-7]{55}$ ]]; }
is_hash() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
is_number() { [[ "$1" =~ ^[0-9]+$ ]]; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

case "$NETWORK" in
  testnet | mainnet) ;;
  *) die "Unknown NETWORK '$NETWORK'. Supported: testnet, mainnet." ;;
esac
command -v stellar >/dev/null || die "stellar CLI not found. Install: brew install stellar-cli"

CONTRACT_ID="${1:-}"
if [ -z "$CONTRACT_ID" ] && [ -f "$ENV_FILE" ]; then
  CONTRACT_ID="$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "$ENV_FILE" | cut -d= -f2)"
fi
[ -n "$CONTRACT_ID" ] || die "usage: scripts/upgrade.sh <CONTRACT_ID>  (or run scripts/deploy.sh first)"
is_contract_id "$CONTRACT_ID" || die "'$CONTRACT_ID' is not a contract id"

MAIN_ID=""
if [ -f "$MAIN_ENV" ]; then
  MAIN_ID="$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "$MAIN_ENV" | cut -d= -f2 || true)"
fi
IS_MAIN=""
[ "$CONTRACT_ID" = "$MAIN_ID" ] && IS_MAIN=1

view() {
  stellar contract invoke --id "$CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" \
    --send=no -- "$@"
}
send() {
  stellar contract invoke --id "$CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- "$@"
}
onchain_hash() {
  local out
  out="$(mktemp)"
  stellar contract fetch --id "$CONTRACT_ID" --network "$NETWORK" -o "$out" >/dev/null 2>&1 ||
    { rm -f "$out"; return 1; }
  sha "$out"
  rm -f "$out"
}

# ------------------------------------------------------------ the contract

step "Contract"
ADMIN="$(view admin | tr -d '"')"
[ "$ADMIN" = "$(stellar keys address "$SOURCE")" ] ||
  die "$SOURCE is not the admin of $CONTRACT_ID (admin is $ADMIN)"
[ "$(view upgrades_enabled)" = "true" ] ||
  die "Upgrades are locked on $CONTRACT_ID; its code is final."
VERSION_BEFORE="$(view version)"
STORAGE_BEFORE="$(view storage_version)"
is_number "$VERSION_BEFORE" && is_number "$STORAGE_BEFORE" ||
  die "Could not read version/storage_version (got '$VERSION_BEFORE' / '$STORAGE_BEFORE')"
HASH_BEFORE="$(onchain_hash || echo unknown)"
echo "contract:        $CONTRACT_ID${IS_MAIN:+  (the main deployment in $MAIN_ENV)}"
echo "code hash:       $HASH_BEFORE"
echo "version:         $VERSION_BEFORE"
echo "storage_version: $STORAGE_BEFORE"

# ---------------------------------------------------------------- the wasm

if [ -z "${WASM:-}" ]; then
  step "Build"
  stellar contract build --package sisonke-escrow
  WASM="target/wasm32v1-none/release/sisonke_escrow.wasm"
fi
test -f "$WASM" || die "No wasm at $WASM"
NEW_HASH="$(sha "$WASM")"

step "Check $WASM"
IS_FIXTURE=""
if [ "$NEW_HASH" = "$(sha "$FIXTURE")" ] ||
  { [ -f "$FIXTURE_BUILD" ] && [ "$NEW_HASH" = "$(sha "$FIXTURE_BUILD")" ]; }; then
  IS_FIXTURE=1
fi
if [ -n "$IS_FIXTURE" ] && [ "$ALLOW_FIXTURE" != "1" ]; then
  die "$WASM is the test-only upgrade fixture${IS_MAIN:+ and $CONTRACT_ID is the main deployment}. It has no escrow functions and must never be installed on a real instance. (upgrade-demo.sh sets ALLOW_FIXTURE=1 for its throwaway instance.)"
fi

EXPORTS="$(stellar contract info interface --wasm "$WASM" 2>/dev/null | sed -n 's/^ *fn \([a-z_0-9]*\)(.*/\1/p')"
[ -n "$EXPORTS" ] || die "Could not read the interface of $WASM"
# Every version keeps these, so the code can always be upgraded, migrated and inspected.
REQUIRED="upgrade migrate version storage_version admin"
if [ -z "$IS_FIXTURE" ]; then
  REQUIRED="$REQUIRED lock_upgrades upgrades_enabled set_paused propose_admin accept_admin
    cancel_admin_proposal create create_and_fund fund release refund reclaim dispute resolve
    cancel get_escrow get_escrows extend_escrow_ttl extend_index_ttl total_locked token"
fi
for fn in $REQUIRED; do
  grep -qx "$fn" <<<"$EXPORTS" || die "$WASM does not export $fn(); every version must keep it."
done
echo "✓ exports every required function"

meta() {
  stellar contract info meta --wasm "$WASM" 2>/dev/null |
    sed -n "s/^.* $1: \([0-9][0-9]*\)$/\1/p" | head -1
}
NEW_VERSION="$(meta sisonke_version)"
NEW_STORAGE="$(meta sisonke_storage_version)"
is_number "$NEW_VERSION" && is_number "$NEW_STORAGE" ||
  die "$WASM has no sisonke_version / sisonke_storage_version metadata (contractmeta!)."
echo "new version:     $NEW_VERSION (storage $NEW_STORAGE)"

if [ "$NEW_VERSION" -le "$VERSION_BEFORE" ] && [ "$ROLLBACK" != "1" ]; then
  die "Version must go up ($VERSION_BEFORE → $NEW_VERSION). For a rollback set ROLLBACK=1."
fi
if [ "$NEW_STORAGE" -gt $((STORAGE_BEFORE + 1)) ]; then
  die "Storage version jumps $STORAGE_BEFORE → $NEW_STORAGE; migrations can't skip versions. Upgrade through each version in turn."
fi
if [ "$NEW_STORAGE" -lt "$STORAGE_BEFORE" ]; then
  [ "$ROLLBACK" = "1" ] || die "Storage version would go down ($STORAGE_BEFORE → $NEW_STORAGE). Set ROLLBACK=1 if intended."
  printf '\033[1;31m!!! The stored data is layout %s; this code expects %s and will refuse every\n' "$STORAGE_BEFORE" "$NEW_STORAGE"
  printf '!!! escrow write (MigrationRequired) until upgraded forward again.\033[0m\n'
fi
if [ "$NEW_STORAGE" -eq $((STORAGE_BEFORE + 1)) ] && [ "$MIGRATE" != "1" ]; then
  printf '\033[1;31m!!! This version changes the storage layout. Escrow writes are blocked until\n'
  printf '!!! migrate runs: set MIGRATE=1, or anyone can call migrate afterwards.\033[0m\n'
fi

# ----------------------------------------------------------------- confirm

step "Confirm"
echo "network:  $NETWORK"
echo "contract: $CONTRACT_ID${IS_MAIN:+ (main deployment)}"
echo "code:     $HASH_BEFORE (v$VERSION_BEFORE) → $NEW_HASH (v$NEW_VERSION)"
if [ "$YES" != "1" ]; then
  [ -t 0 ] || die "Not interactive: re-run with YES=1 to confirm."
  read -r -p "Type 'upgrade' to install this code: " answer
  [ "$answer" = "upgrade" ] || die "Not confirmed; nothing sent."
fi

# ------------------------------------------------------------------ upgrade

step "Upload"
HASH="$(stellar contract upload --wasm "$WASM" --source "$SOURCE" --network "$NETWORK")"
is_hash "$HASH" || die "Upload returned '$HASH', not a wasm hash"
[ "$HASH" = "$NEW_HASH" ] || die "Uploaded hash $HASH differs from the local wasm $NEW_HASH"
echo "wasm hash: $HASH"

step "Upgrade"
send upgrade --new_wasm_hash "$HASH"
HASH_AFTER="$(onchain_hash || echo unknown)"
[ "$HASH_AFTER" = "$HASH" ] || die "On-chain code hash is $HASH_AFTER, expected $HASH"
echo "✓ on-chain code hash = $HASH"
VERSION_AFTER="$(view version)"
[ "$VERSION_AFTER" = "$NEW_VERSION" ] || die "version() is $VERSION_AFTER, the wasm says $NEW_VERSION"
echo "version:         $VERSION_BEFORE → $VERSION_AFTER"

# A migration is pending exactly when simulating migrate succeeds.
if view migrate >/dev/null 2>&1; then
  if [ "$MIGRATE" = "1" ]; then
    step "Migrate"
    send migrate
    STORAGE_AFTER="$(view storage_version)"
    [ "$STORAGE_AFTER" = "$NEW_STORAGE" ] || die "storage_version is $STORAGE_AFTER after migrate, expected $NEW_STORAGE"
    echo "storage_version: $STORAGE_BEFORE → $STORAGE_AFTER"
  else
    printf '\n\033[1;31m!!! A migration is pending: escrow writes are blocked until migrate runs\n'
    printf '!!! (MIGRATE=1, or anyone can call migrate).\033[0m\n'
  fi
elif [ "$MIGRATE" = "1" ]; then
  echo "Nothing to migrate: the stored data is already in the new layout."
fi

if [ -f "$ENV_FILE" ] && grep -q "^NEXT_PUBLIC_SISONKE_CONTRACT_ID=$CONTRACT_ID\$" "$ENV_FILE"; then
  tmp="$(mktemp)"
  grep -v '^SISONKE_WASM_HASH=' "$ENV_FILE" >"$tmp"
  echo "SISONKE_WASM_HASH=$HASH" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
  echo "Updated SISONKE_WASM_HASH in $ENV_FILE"
fi

step "Done"
echo "Same address, new code: https://stellar.expert/explorer/$NETWORK/contract/$CONTRACT_ID"
