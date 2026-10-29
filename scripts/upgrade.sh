#!/usr/bin/env bash
# Timelocked, UUPS-style upgrade of a deployed sisonke-escrow: the address,
# storage and locked funds stay the same, only the code changes, and only
# after a public delay during which every user can still exit.
#
#   scripts/upgrade.sh propose [CONTRACT_ID]     # check + upload the wasm, propose_upgrade (starts the delay)
#   scripts/upgrade.sh execute [CONTRACT_ID]     # after the eta: upgrade, verify, optionally migrate
#   scripts/upgrade.sh cancel  [CONTRACT_ID]     # cancel_upgrade
#
#   WASM=path/to.wasm scripts/upgrade.sh propose    # a specific wasm (default: build the current source)
#   MIGRATE=1 scripts/upgrade.sh execute            # run the new code's migrate right after
#   WASM=old.wasm ROLLBACK=1 scripts/upgrade.sh propose   # rollback = propose an older wasm
#
# Env:
#   NETWORK        testnet (default) or mainnet
#   SOURCE         sisonke-deployer: uploads the wasm and pays fees; signs nothing for the admin
#   ADMIN_NAME     sisonke-admin: the admin multisig identity (scripts/multisig-admin.sh)
#   ADMIN_SIGNERS  identities that sign for the admin, comma-separated
#                  (default <ADMIN_NAME>-signer-1,<ADMIN_NAME>-signer-2: 2 of the 3)
#   ENV_FILE       deployments/<network>.env: default CONTRACT_ID; SISONKE_WASM_HASH is updated
#   ROLLBACK=1     allow a lower version / storage version
#   ALLOW_FIXTURE=1  allow the test-only upgrade fixture (upgrade-demo.sh only)
#   YES=1          skip the interactive confirmation
#
# The admin's signatures are made by scripts/admin.ts: the stellar CLI can't
# sign one call with several of a multisig account's keys.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-sisonke-deployer}"
ADMIN_NAME="${ADMIN_NAME:-sisonke-admin}"
ADMIN_SIGNERS="${ADMIN_SIGNERS:-$ADMIN_NAME-signer-1,$ADMIN_NAME-signer-2}"
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

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*" >&2; }
die() { echo "✖ $*" >&2; exit 1; }
is_contract_id() { [[ "$1" =~ ^C[A-Z2-7]{55}$ ]]; }
is_hash() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
is_number() { [[ "$1" =~ ^[0-9]+$ ]]; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

COMMAND="${1:-}"
case "$COMMAND" in
  propose | execute | cancel) ;;
  *) die "usage: scripts/upgrade.sh propose|execute|cancel [CONTRACT_ID]" ;;
esac
case "$NETWORK" in
  testnet)
    PASSPHRASE="Test SDF Network ; September 2015"
    RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
    ;;
  mainnet)
    PASSPHRASE="Public Global Stellar Network ; September 2015"
    RPC_URL="${RPC_URL:?set RPC_URL for mainnet}"
    ;;
  *) die "Unknown NETWORK '$NETWORK'. Supported: testnet, mainnet." ;;
esac
NET=(--rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE")
command -v stellar >/dev/null || die "stellar CLI not found. Install: brew install stellar-cli"
command -v node >/dev/null || die "node not found (needed for scripts/admin.ts)"
[ -d scripts/node_modules ] || npm ci --prefix scripts --silent

CONTRACT_ID="${2:-}"
if [ -z "$CONTRACT_ID" ] && [ -f "$ENV_FILE" ]; then
  CONTRACT_ID="$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "$ENV_FILE" | cut -d= -f2)"
fi
[ -n "$CONTRACT_ID" ] || die "No CONTRACT_ID (argument, or run scripts/deploy.sh first)"
is_contract_id "$CONTRACT_ID" || die "'$CONTRACT_ID' is not a contract id"

MAIN_ID=""
if [ -f "$MAIN_ENV" ]; then
  MAIN_ID="$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "$MAIN_ENV" | cut -d= -f2 || true)"
fi
IS_MAIN=""
[ "$CONTRACT_ID" = "$MAIN_ID" ] && IS_MAIN=1

view() {
  stellar contract invoke --id "$CONTRACT_ID" --source "$SOURCE" "${NET[@]}" --send=no -- "$@"
}
admin_ts() {
  NEXT_PUBLIC_NETWORK_PASSPHRASE="$PASSPHRASE" NEXT_PUBLIC_RPC_URL="$RPC_URL" \
    node scripts/admin.ts "$@" --contract "$CONTRACT_ID" --signers "$ADMIN_SIGNERS" \
    --fee-payer "$SOURCE" --env-file "$ENV_FILE"
}
# key=value from `node admin.ts status`.
status_of() { sed -n "s/^$1=//p" <<<"$STATUS"; }
json_field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" <<<"$2"; }
onchain_hash() {
  local out
  out="$(mktemp)"
  stellar contract fetch --id "$CONTRACT_ID" "${NET[@]}" -o "$out" >/dev/null 2>&1 ||
    { rm -f "$out"; return 1; }
  sha "$out"
  rm -f "$out"
}
confirm() {
  [ "$YES" = "1" ] && return 0
  [ -t 0 ] || die "Not interactive: re-run with YES=1 to confirm."
  read -r -p "Type '$1' to continue: " answer
  [ "$answer" = "$1" ] || die "Not confirmed; nothing sent."
}

# ------------------------------------------------------------ the contract

step "Contract"
STATUS="$(admin_ts status)"
[ "$(status_of upgrades_enabled)" = "true" ] || die "Upgrades are locked on $CONTRACT_ID; its code is final."
VERSION_BEFORE="$(status_of version)"
STORAGE_BEFORE="$(status_of storage_version)"
is_number "$VERSION_BEFORE" && is_number "$STORAGE_BEFORE" ||
  die "Could not read version/storage_version (got '$VERSION_BEFORE' / '$STORAGE_BEFORE')"
HASH_BEFORE="$(onchain_hash || echo unknown)"
{
  echo "contract:        $CONTRACT_ID${IS_MAIN:+  (the main deployment in $MAIN_ENV)}"
  echo "admin:           $(status_of admin) (signing: $ADMIN_SIGNERS)"
  echo "code hash:       $HASH_BEFORE"
  echo "version:         $VERSION_BEFORE (storage $STORAGE_BEFORE)"
  echo "upgrade delay:   $(status_of upgrade_delay) s"
  if [ -n "$(status_of pending_hash)" ]; then
    echo "pending upgrade: $(status_of pending_hash), eta $(status_of pending_eta), expires $(status_of pending_expires_at)"
  else
    echo "pending upgrade: none"
  fi
} >&2

# ----------------------------------------------------------------- cancel

if [ "$COMMAND" = "cancel" ]; then
  [ -n "$(status_of pending_hash)" ] || die "No upgrade is pending."
  confirm cancel
  OUT="$(admin_ts cancel)" || die "cancel_upgrade failed: $OUT"
  echo "✓ cancelled: tx $(json_field hash "$OUT")" >&2
  echo "$OUT"
  exit 0
fi

# ---------------------------------------------------------------- propose

if [ "$COMMAND" = "propose" ]; then
  if [ -z "${WASM:-}" ]; then
    step "Build"
    stellar contract build --package sisonke-escrow >&2
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

  # name(param types) for every exported function, e.g. "upgrade(BytesN<32>)".
  SIGNATURES="$(stellar contract info interface --wasm "$WASM" 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g' |
    tr ';{}' '\n\n\n' | sed -n 's/^ *fn \([a-z_0-9]*\)(\([^)]*\)).*$/\1(\2)/p' |
    sed -E 's/soroban_sdk:://g; s/env: Env,? ?//; s/[a-z_0-9]+: //g; s/ //g; s/,\)/)/')"
  [ -n "$SIGNATURES" ] || die "Could not read the interface of $WASM"
  # Every version keeps these, with these parameter types, so its code can
  # always be upgraded again (through the same timelock, bound to a hash),
  # locked, migrated and inspected.
  REQUIRED="propose_upgrade(BytesN<32>) upgrade(BytesN<32>) cancel_upgrade() lock_upgrades()
    upgrade_delay() pending_upgrade() migrate() version() storage_version() admin()"
  if [ -z "$IS_FIXTURE" ]; then
    REQUIRED="$REQUIRED set_upgrade_delay(u64) upgrades_enabled() set_paused(bool) propose_admin(Address)
      accept_admin() cancel_admin_proposal()
      create(Address,Address,Option<Address>,i128,u64,String,Option<BytesN<32>>)
      create_and_fund(Address,Address,Option<Address>,i128,u64,String,Option<BytesN<32>>)
      fund(u64) release(u64) refund(u64) reclaim(u64) dispute(u64,Address) resolve(u64,i128)
      cancel(u64) get_escrow(u64) get_escrows(Vec<u64>) extend_escrow_ttl(u64)
      extend_index_ttl(Address,PartyRole,u32) total_locked() token()"
  fi
  for sig in $REQUIRED; do
    grep -qxF "$sig" <<<"$SIGNATURES" ||
      die "$WASM does not export $sig (with exactly these parameters); every version must keep it. It has: $(grep -E "^${sig%%(*}\(" <<<"$SIGNATURES" || echo none)"
  done
  echo "✓ exports every required function with the required parameters" >&2

  meta() {
    stellar contract info meta --wasm "$WASM" 2>/dev/null |
      sed -n "s/^.* $1: \([0-9][0-9]*\)$/\1/p" | head -1
  }
  NEW_VERSION="$(meta sisonke_version)"
  NEW_STORAGE="$(meta sisonke_storage_version)"
  is_number "$NEW_VERSION" && is_number "$NEW_STORAGE" ||
    die "$WASM has no sisonke_version / sisonke_storage_version metadata (contractmeta!)."
  echo "new version:     $NEW_VERSION (storage $NEW_STORAGE)" >&2
  if [ "$NEW_VERSION" -le "$VERSION_BEFORE" ] && [ "$ROLLBACK" != "1" ]; then
    die "Version must go up ($VERSION_BEFORE → $NEW_VERSION). For a rollback set ROLLBACK=1."
  fi
  if [ "$NEW_STORAGE" -gt $((STORAGE_BEFORE + 1)) ]; then
    die "Storage version jumps $STORAGE_BEFORE → $NEW_STORAGE; migrations can't skip versions."
  fi
  if [ "$NEW_STORAGE" -lt "$STORAGE_BEFORE" ]; then
    [ "$ROLLBACK" = "1" ] || die "Storage version would go down ($STORAGE_BEFORE → $NEW_STORAGE). Set ROLLBACK=1 if intended."
    echo "!!! The stored data is layout $STORAGE_BEFORE; this code expects $NEW_STORAGE and will refuse every escrow write until upgraded forward again." >&2
  fi
  if [ -n "$(status_of pending_hash)" ]; then
    echo "!!! This replaces the pending proposal $(status_of pending_hash) and restarts the delay." >&2
  fi

  step "Confirm"
  echo "network $NETWORK, contract $CONTRACT_ID${IS_MAIN:+ (main deployment)}" >&2
  echo "propose $NEW_HASH (v$NEW_VERSION) to replace $HASH_BEFORE (v$VERSION_BEFORE)" >&2
  confirm propose

  step "Upload"
  HASH="$(stellar contract upload --wasm "$WASM" --source "$SOURCE" "${NET[@]}")"
  is_hash "$HASH" || die "Upload returned '$HASH', not a wasm hash"
  [ "$HASH" = "$NEW_HASH" ] || die "Uploaded hash $HASH differs from the local wasm $NEW_HASH"

  step "Propose"
  OUT="$(admin_ts propose "$HASH")" || die "propose_upgrade failed: $OUT"
  STATUS="$(admin_ts status)"
  [ "$(status_of pending_hash)" = "$HASH" ] || die "The pending upgrade is $(status_of pending_hash), expected $HASH"
  echo "✓ proposed $HASH in tx $(json_field hash "$OUT"); it can run from $(status_of pending_eta) (unix time)." >&2
  echo "  Until then every escrow can be exited. Run: scripts/upgrade.sh execute $CONTRACT_ID" >&2
  echo "$OUT"
  exit 0
fi

# ---------------------------------------------------------------- execute

PENDING="$(status_of pending_hash)"
ETA="$(status_of pending_eta)"
EXPIRES="$(status_of pending_expires_at)"
NOW="$(status_of ledger_time)"
[ -n "$PENDING" ] || die "No upgrade is pending. Propose one first."
is_number "$ETA" && is_number "$EXPIRES" && is_number "$NOW" || die "Could not read the eta / expiry / ledger time"
[ "$NOW" -ge "$ETA" ] || die "Too early: the upgrade can run from $ETA, the ledger time is $NOW ($((ETA - NOW)) s to go)."
[ "$NOW" -le "$EXPIRES" ] || die "Expired: the proposal could run until $EXPIRES (ledger time $NOW). Propose it again; that restarts the delay."
if [ -n "${WASM:-}" ]; then
  [ "$(sha "$WASM")" = "$PENDING" ] || die "The pending upgrade is $PENDING, not $WASM"
fi

step "Confirm"
echo "network $NETWORK, contract $CONTRACT_ID${IS_MAIN:+ (main deployment)}: install $PENDING" >&2
echo "(the signatures are bound to this hash: upgrade(expected_wasm_hash))" >&2
confirm execute

step "Upgrade"
OUT="$(admin_ts execute)" || die "upgrade failed: $OUT"
HASH_AFTER="$(onchain_hash || echo unknown)"
[ "$HASH_AFTER" = "$PENDING" ] || die "On-chain code hash is $HASH_AFTER, expected $PENDING"
echo "✓ upgraded in tx $(json_field hash "$OUT"); on-chain code hash = $PENDING" >&2
echo "version:         $VERSION_BEFORE → $(view version)" >&2
echo "$OUT"

# A migration is pending exactly when simulating migrate succeeds.
if view migrate >/dev/null 2>&1; then
  if [ "$MIGRATE" = "1" ]; then
    step "Migrate"
    stellar contract invoke --id "$CONTRACT_ID" --source "$SOURCE" "${NET[@]}" -- migrate >&2
    echo "storage_version: $STORAGE_BEFORE → $(view storage_version)" >&2
  else
    printf '\n\033[1;31m!!! A migration is pending: escrow writes are blocked until migrate runs\n' >&2
    printf '!!! (MIGRATE=1, or anyone can call migrate).\033[0m\n' >&2
  fi
elif [ "$MIGRATE" = "1" ]; then
  echo "Nothing to migrate: the stored data is already in the new layout." >&2
fi

if [ -f "$ENV_FILE" ] && grep -q "^NEXT_PUBLIC_SISONKE_CONTRACT_ID=$CONTRACT_ID\$" "$ENV_FILE"; then
  tmp="$(mktemp)"
  grep -v '^SISONKE_WASM_HASH=' "$ENV_FILE" >"$tmp"
  echo "SISONKE_WASM_HASH=$PENDING" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
  echo "Updated SISONKE_WASM_HASH in $ENV_FILE" >&2
fi
