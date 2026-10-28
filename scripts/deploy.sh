#!/usr/bin/env bash
# Deploys sisonke-escrow, pinned to Circle USDC for the network.
#
#   scripts/deploy.sh                                   # Testnet
#   NETWORK=mainnet ADMIN=G...multisig RPC_URL=... scripts/deploy.sh
#
# Env:
#   NETWORK   testnet (default) or mainnet; anything else is refused
#   SOURCE    sisonke-deployer: stellar CLI identity that pays for the deploy
#             (created and Friendbot-funded on Testnet only)
#   ADMIN     admin address. Testnet: defaults to the SOURCE address.
#             Off Testnet: required, and must not be the SOURCE key (use a
#             multisig account; the admin can upgrade the code, see docs/UPGRADES.md)
#   ALIAS     sisonke-escrow (stellar CLI contract alias)
#   ENV_FILE  deployments/<network>.env, or deployments/<network>.<alias>.env for
#             any other alias, so a demo instance never overwrites the real one
#   FORCE=1   allow replacing an existing ENV_FILE (the previous one is kept as
#             <file>.<timestamp>.bak)
#   RPC_URL, HORIZON_URL  required off Testnet
#
# The token is pinned forever at construction, so the USDC issuer and SAC id
# come from the table below and are checked, never guessed.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-sisonke-deployer}"
ALIAS="${ALIAS:-sisonke-escrow}"
FORCE="${FORCE:-}"
WASM="target/wasm32v1-none/release/sisonke_escrow.wasm"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { echo "✖ $*" >&2; exit 1; }
is_contract_id() { [[ "$1" =~ ^C[A-Z2-7]{55}$ ]]; }
is_account_id() { [[ "$1" =~ ^G[A-Z2-7]{55}$ ]]; }
is_hash() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
is_number() { [[ "$1" =~ ^[0-9]+$ ]]; }

# Circle USDC per network: issuer, SAC id, passphrase, default RPC / Horizon.
case "$NETWORK" in
  testnet)
    USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
    PASSPHRASE="Test SDF Network ; September 2015"
    RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
    HORIZON_URL="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
    ;;
  mainnet)
    USDC_ISSUER="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    USDC_SAC="CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
    PASSPHRASE="Public Global Stellar Network ; September 2015"
    RPC_URL="${RPC_URL:?set RPC_URL for mainnet}"
    HORIZON_URL="${HORIZON_URL:-https://horizon.stellar.org}"
    ;;
  *)
    die "Unknown NETWORK '$NETWORK'. Supported: testnet, mainnet (each with a checked USDC issuer and SAC id)."
    ;;
esac
EXPLORER_URL="https://stellar.expert/explorer/$NETWORK"
# Every RPC call uses the table's endpoint and passphrase explicitly, never a
# CLI network config that could point somewhere else. (The `keys` commands keep
# --network: they only run on Testnet, for Friendbot.)
NET=(--rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE")

if [ "$ALIAS" = "sisonke-escrow" ]; then
  ENV_FILE="${ENV_FILE:-deployments/$NETWORK.env}"
else
  ENV_FILE="${ENV_FILE:-deployments/$NETWORK.$ALIAS.env}"
fi

command -v stellar >/dev/null || die "stellar CLI not found. Install: brew install stellar-cli"

view() {
  stellar contract invoke --id "$1" --source "$SOURCE" "${NET[@]}" --send=no -- "${@:2}"
}

# 0. Never silently replace a recorded deployment.
step "Existing deployment"
if [ -f "$ENV_FILE" ]; then
  OLD_ID="$(grep '^NEXT_PUBLIC_SISONKE_CONTRACT_ID=' "$ENV_FILE" | cut -d= -f2 || true)"
  echo "$ENV_FILE already records ${OLD_ID:-no contract id}"
  if [ -n "$OLD_ID" ]; then
    OLD_LOCKED="$(view "$OLD_ID" total_locked 2>/dev/null | tr -d '"' || echo "unreachable")"
    echo "its total_locked: $OLD_LOCKED"
  fi
  [ "$FORCE" = "1" ] || die "Refusing to replace it. Re-run with FORCE=1 to deploy a new instance anyway."
  cp "$ENV_FILE" "$ENV_FILE.$(date -u +%Y%m%dT%H%M%SZ).bak"
  echo "kept a copy of the old file"
else
  echo "none at $ENV_FILE"
fi

# 1. Deployer identity. Friendbot only on Testnet.
step "Deployer identity ($SOURCE)"
if ! stellar keys address "$SOURCE" >/dev/null 2>&1; then
  [ "$NETWORK" = "testnet" ] || die "Identity $SOURCE not found. Add a funded key: stellar keys add $SOURCE"
  stellar keys generate "$SOURCE" --network "$NETWORK" --fund
elif [ "$NETWORK" = "testnet" ]; then
  # Re-fund after a Testnet reset; harmless if the account already exists.
  stellar keys fund "$SOURCE" --network "$NETWORK" >/dev/null 2>&1 || true
fi
SOURCE_ADDRESS="$(stellar keys address "$SOURCE")"
is_account_id "$SOURCE_ADDRESS" || die "Unexpected address for $SOURCE: '$SOURCE_ADDRESS'"

if [ "$NETWORK" = "testnet" ]; then
  ADMIN="${ADMIN:-$SOURCE_ADDRESS}"
else
  [ -n "${ADMIN:-}" ] || die "Set ADMIN explicitly off Testnet (a multisig account, not the deployer key)."
  [ "$ADMIN" != "$SOURCE_ADDRESS" ] || die "ADMIN must not be the deployer key $SOURCE off Testnet."
fi
is_account_id "$ADMIN" || is_contract_id "$ADMIN" || die "ADMIN is not a Stellar address: '$ADMIN'"
echo "deployer: $SOURCE_ADDRESS"
echo "admin:    $ADMIN"

# 2. USDC Stellar Asset Contract: must be exactly the expected id.
step "USDC Stellar Asset Contract"
USDC_SAC_ID="$(stellar contract id asset --asset "USDC:$USDC_ISSUER" "${NET[@]}")"
[ "$USDC_SAC_ID" = "$USDC_SAC" ] ||
  die "USDC:$USDC_ISSUER resolves to '$USDC_SAC_ID', expected $USDC_SAC."
if ! view "$USDC_SAC_ID" decimals >/dev/null 2>&1; then
  # Only Testnet may deploy it (after a reset); elsewhere it must already exist.
  [ "$NETWORK" = "testnet" ] || die "USDC SAC $USDC_SAC_ID is not deployed on $NETWORK. Refusing to deploy it."
  echo "SAC not deployed on $NETWORK yet; deploying it"
  stellar contract asset deploy --asset "USDC:$USDC_ISSUER" --source "$SOURCE" "${NET[@]}" >/dev/null
fi
DECIMALS="$(view "$USDC_SAC_ID" decimals)"
[ "$DECIMALS" = "7" ] || die "USDC SAC reports decimals '$DECIMALS', expected 7"
echo "usdc sac: $USDC_SAC_ID (decimals $DECIMALS)"

# 3. Build and upload.
step "Build"
GIT_REV="$(git describe --always --dirty 2>/dev/null || echo uncommitted)"
if [ "$NETWORK" != "testnet" ] && [[ "$GIT_REV" == "uncommitted" || "$GIT_REV" == *-dirty ]]; then
  die "Refusing to deploy to $NETWORK from an uncommitted tree ($GIT_REV): it can't be rebuilt reproducibly."
fi
stellar contract build --package sisonke-escrow
test -f "$WASM" || die "Expected $WASM. Check the path 'stellar contract build' printed."
echo "source: $GIT_REV"

step "Upload"
WASM_HASH="$(stellar contract upload --wasm "$WASM" --source "$SOURCE" "${NET[@]}")"
is_hash "$WASM_HASH" || die "Upload returned '$WASM_HASH', not a wasm hash"
[ "$WASM_HASH" = "$(shasum -a 256 "$WASM" | cut -d' ' -f1)" ] || die "Uploaded hash differs from the local wasm"
echo "wasm hash: $WASM_HASH"

# 4. Deploy with constructor args. The constructor runs in the same
#    transaction, so nobody can initialise the contract first. The ledger is
#    read first, so DEPLOY_LEDGER is at or before the `init` event.
step "Deploy ($ALIAS)"
DEPLOY_LEDGER="$(
  stellar ledger latest "${NET[@]}" --output json |
    sed -n 's/.*"sequence":[[:space:]]*\([0-9][0-9]*\).*/\1/p'
)"
is_number "$DEPLOY_LEDGER" || die "Could not read the latest ledger (got '$DEPLOY_LEDGER')"
DEPLOY_LOG="$(mktemp)"
if ! CONTRACT_ID="$(
  stellar contract deploy \
    --wasm-hash "$WASM_HASH" \
    --source "$SOURCE" "${NET[@]}" \
    --alias "$ALIAS" \
    -- --admin "$ADMIN" --token "$USDC_SAC_ID" 2>"$DEPLOY_LOG"
)"; then
  cat "$DEPLOY_LOG" >&2
  die "Deploy failed"
fi
cat "$DEPLOY_LOG" >&2
is_contract_id "$CONTRACT_ID" || die "Deploy returned '$CONTRACT_ID', not a contract id"
DEPLOY_TX="$(grep -oE '[0-9a-f]{64}' "$DEPLOY_LOG" | grep -v "$WASM_HASH" | tail -1 || true)"
rm -f "$DEPLOY_LOG"
echo "sisonke-escrow: $CONTRACT_ID"
echo "deploy ledger:  ≥ $DEPLOY_LEDGER, tx ${DEPLOY_TX:-unknown}"

# 5. Sanity reads: the constructor ran with the right values.
step "Sanity checks"
expect() {
  local got
  got="$(view "$CONTRACT_ID" "$1" | tr -d '"')"
  [ "$got" = "$2" ] || die "$1 is '$got', expected '$2'"
  echo "✓ $1 = $got"
}
expect token "$USDC_SAC_ID"
expect version 1
expect storage_version 1
expect is_paused false
expect upgrades_enabled true
expect admin "$ADMIN"
expect escrow_count 0

# 6. Record the deployment.
mkdir -p "$(dirname "$ENV_FILE")"
cat >"$ENV_FILE" <<EOF
# Generated by scripts/deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) from $GIT_REV. All values are public.
NEXT_PUBLIC_STELLAR_NETWORK=$NETWORK
# Quoted: the passphrase has spaces and a semicolon, and upgrade-demo.sh sources this file.
NEXT_PUBLIC_NETWORK_PASSPHRASE="$PASSPHRASE"
NEXT_PUBLIC_RPC_URL=$RPC_URL
NEXT_PUBLIC_HORIZON_URL=$HORIZON_URL
NEXT_PUBLIC_EXPLORER_URL=$EXPLORER_URL
NEXT_PUBLIC_SISONKE_CONTRACT_ID=$CONTRACT_ID
NEXT_PUBLIC_USDC_SAC_ID=$USDC_SAC_ID
NEXT_PUBLIC_USDC_ISSUER=$USDC_ISSUER
NEXT_PUBLIC_SISONKE_DEPLOY_LEDGER=$DEPLOY_LEDGER
SISONKE_DEPLOY_TX=${DEPLOY_TX:-unknown}
SISONKE_WASM_HASH=$WASM_HASH
SISONKE_ADMIN=$ADMIN
SISONKE_SOURCE_REV=$GIT_REV
EOF

# 7. Done. TypeScript bindings come with the web app (scripts/bindings.sh).
step "Done"
echo "Contract:  $CONTRACT_ID"
echo "Explorer:  $EXPLORER_URL/contract/$CONTRACT_ID"
echo "Env file:  $ENV_FILE"
