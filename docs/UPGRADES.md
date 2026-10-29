# Upgrading sisonke-escrow

sisonke-escrow upgrades the way Solidity's UUPS proxies do, without a proxy: the upgrade
functions live in the contract itself, and swapping the code keeps the contract address, all
storage and every locked token. Upgrades are **timelocked** and the admin is a **native Stellar
multisig account**. This page covers how to ship a v2, the rules a new version must follow, how the
multisig is checked, and the trust model. The contract reference is [CONTRACT.md](CONTRACT.md);
web-app duties are in [INTEGRATION.md](INTEGRATION.md).

> **Trust assumption #1: the admin can upgrade the code after a public delay; during it, either
> party can move each escrow's funds out of the new code's reach.** New code can move every locked
> token, so until `lock_upgrades()` is called, trusting a Sisonke instance means trusting its admin.
> What limits that trust:
> 1. **The delay and its window.** `propose_upgrade(hash)` publishes the wasm hash with an `eta` and
>    an `expires_at = eta + 7 days`. `upgrade(hash)` refuses before `eta` (204), after `expires_at`
>    (207), and for any other hash (206). An expired proposal must be proposed again, with a fresh
>    delay. The delay is fixed at deploy and can only be raised, and raising it pushes out a pending
>    proposal too. The contract accepts 60 s to 30 days on any network; deploy.sh's policy is 1 hour
>    on Testnet and at least 2 days on mainnet, so integrators read `upgrade_delay()` rather than
>    assume it. A handover cancels the old admin's proposal, so a new admin gets no head start.
> 2. **What users can do during the delay.** Every exit function keeps working, so every escrow's
>    funds can be moved out before `eta`. Before the deadline, though, they can only go **toward the
>    counterparty** (payer `release`, recipient `refund`) or through the arbiter. The payer alone only
>    gets money back with `reclaim` after the deadline. Parties who want a unilateral exit should use
>    deadlines shorter than the delay; the web banner says so (INTEGRATION.md §2).
> 3. **Multisig.** The admin is a classic account whose master key has weight 0 and whose signers
>    must reach its medium threshold (2-of-3 by default), so no single key can propose or execute.
>    Every signature on `upgrade` commits to one specific hash.
> 4. **Transparency.** `upgrade_proposed` and `upgraded` events carry the wasm hash; anyone can
>    `stellar contract fetch` the live code and compare it with a reproducible build.
> 5. **`lock_upgrades()`.** Permanent, survives every handover, cancels any pending proposal.
>
> The delay only protects users who notice the proposal, which is why the web app must show
> `pending_upgrade()` as a banner (INTEGRATION.md §2).

## Mapping to UUPS / OpenZeppelin

| UUPS / OZ | Sisonke |
|---|---|
| `upgradeTo(impl)` in the implementation | `propose_upgrade(hash)`, wait `upgrade_delay()`, then `upgrade(hash)` in the contract itself: `update_current_contract(ContractExecutable::Wasm(..))` |
| `TimelockController` (delay + grace period) | the built-in delay and 7-day execution window: `PendingUpgrade { wasm_hash, proposed_at, eta, expires_at }`, `cancel_upgrade`, `set_upgrade_delay` (increase only) |
| `_authorizeUpgrade onlyOwner` | `Admin.require_auth()`, with the admin a native multisig account |
| proxy keeps storage + balance | same contract address; storage and SAC balances untouched |
| `upgradeToAndCall` | `upgrade` transaction, then a `migrate()` transaction (Soroban has no self re-entry). Escrow writes are refused until migrated. |
| final implementation without upgrade | `lock_upgrades()`, permanent; every future version must keep honouring `UpgradesLocked` |
| `Ownable2Step` | `propose_admin` → `accept_admin`, `cancel_admin_proposal` |

`upgrade` only ever installs a plain wasm hash. `ContractExecutable::ExternalRef` is never used: it
would hand control of the code to whoever owns the referenced entry.

## The upgrade timelock

| Step | Who | Effect | Refusals |
|---|---|---|---|
| `propose_upgrade(hash)` | admin | `PendingUpgrade { wasm_hash: hash, proposed_at: now, eta: now + upgrade_delay, expires_at: eta + 7 days }`; a pending proposal is replaced (event `upgrade_cancelled` for it, then `upgrade_proposed`) and the delay restarts | 200 locked, 143 (only within 30 days of the end of `u64` time) |
| wait | everyone | nothing changes; every exit function still works (before the deadline that moves funds toward the counterparty or via the arbiter, see above); new escrows and funding work too (only pause blocks those) | |
| `upgrade(hash)` | admin | `hash` must be the pending one, and `eta <= now <= expires_at`: clears the proposal, emits `upgraded`, installs `hash` | in order 200 locked, 203 none pending, 206 wrong hash, 204 too early, 207 expired |
| `cancel_upgrade()` | admin | clears the proposal (expired or not); event `upgrade_cancelled` | 203 |
| `set_upgrade_delay(d)` | admin | `d` within 60 s ..= 30 days and `>=` the current delay; a pending proposal's `eta` becomes `max(eta, proposed_at + d)` and `expires_at` follows; event `upgrade_delay_changed {previous, delay, pending_eta}` | 202, 205 |
| `lock_upgrades()` | admin | clears the proposal (event `upgrade_cancelled`), then locks for good | 141, 200 |
| `accept_admin()` | new admin | also clears the old admin's proposal (event `upgrade_cancelled`) | 201 |

`propose_upgrade` is allowed while a migration is pending (`storage_version()` differs from the
code's), so a broken version can always be replaced. That is the one state in which exits are
blocked, so fixing it must never be blocked too. The wasm itself must already be uploaded
(`stellar contract upload`) before it can run. The contract can't check that at propose time, so an
unknown hash only fails at `upgrade(hash)`, and then nothing changes. A proposal whose wasm isn't
published can't be reviewed; the web app flags it (INTEGRATION.md §2).

## Multisig admin

The admin is a classic Stellar account set up by `scripts/multisig-admin.sh`: exactly N signer
keys of weight 1, low = medium = high threshold = M with M ≥ 2 (default 2-of-3), master key weight 0,
and no other signers. It never needs to hold more than its minimum balance, because fees are paid by
a separate fee payer.

- **Signer keys.** Off Testnet the script never generates them: `SIGNERS=G…,G…,G…` takes the
  signers' own public keys, each created by its owner on their own device. Only Testnet may create
  local identities `<NAME>-signer-i`.
- **Verification.** Every run, fresh or repeated, ends with a full check against Horizon: master
  weight 0, low = med = high = M, exactly the expected signers each of weight 1, nothing else. It
  refuses otherwise; there is no "already configured" shortcut. `deploy.sh` runs the same check
  (`multisig-admin.sh verify`) on `ADMIN` off Testnet.
- **What the contract can't enforce.** The contract only calls `Admin.require_auth()`, so
  "M-of-N, no single key" holds only while the account's on-chain configuration says so. The
  signers can change it, and `propose_admin` can hand the role to any address. Re-run the
  verification after any change, and watch `admin_proposed`.

**What the Soroban host checks** (read in `soroban-env-host` 29.0.1, the version this contract is
built and tested against):

- **Address credentials** (`builtin_contracts/account_contract.rs`, `check_account_authentication`).
  The auth entry's signature is a vector of `{public_key, signature}` maps.
  - It holds 1 to 20 entries (`MAX_ACCOUNT_SIGNATURES`), sorted **strictly ascending by public key**
    with no duplicates.
  - Each signature must verify (ed25519) over the entry's signature payload. The payload is the
    sha256 of the `HashIdPreimage` for Soroban authorization: network id, nonce, expiration ledger
    and the invocation tree. `ADDRESS_V2` (CAP-71) also binds the address.
  - Each key must be a signer of the account with weight > 0, so a weight-0 master key is rejected
    outright.
  - The summed weight must be **at least the account's MEDIUM threshold**.
  - The account contract reports failures as `ContractError::AuthenticationError` (`#5`), and a bad
    signature as a crypto error. But every recoverable failure is then **re-raised as
    `Error(Auth, InvalidAction)`** (`auth.rs`, around line 2492), so the transaction fails with that
    and the original error only shows up in the diagnostic events.
  - The host loads the account entry, so it must be in the transaction footprint. The entry's nonce
    is consumed: a temporary entry is written.
- **Source-account credentials** (`auth.rs`, `authenticate`). The host does **no** signature check
  of its own (`if is_transaction_source_account() { return Ok(()) }`). It relies on stellar-core
  having verified the transaction's signatures against the source account's thresholds before
  execution. An under-signed transaction is therefore rejected before it reaches a ledger, so it
  leaves no on-chain record.
- **Recording simulation** emulates a single signature for account auth, so its resource estimate is
  low for multisig. Simulate in **enforce** mode with the real signatures for exact resources.

**How the scripts sign** (`scripts/admin.ts`). The scripts only ever use address credentials for
the admin. The threshold that applies to source-account credentials is stellar-core's, not
checked here.
- The transaction source is a fee payer (the deployer identity). The admin authorizes the call with
  an address-credential entry signed by M of its signer keys, sorted by public key. Duplicate
  signers are refused before anything is sent.
- **Independent signers** (mainnet): `node admin.ts prepare <op> --out req.json` writes the unsigned
  auth entry, its expiration (about one day) and the payload. Each signer then runs
  `node admin.ts sign req.json --key <identity>` (or `--key -` with the secret on stdin), on their
  own device, offline if they like. `sign` recomputes the payload from the entry and network
  passphrase, prints the network, contract, admin, call and arguments (including the wasm hash)
  before signing, and refuses a request whose summary doesn't match its entry, or a second
  signature from the same key. Whoever holds the file then runs `node admin.ts submit req.json`.
  Secret keys are never accepted on the command line.
- **One process** (Testnet convenience): `node admin.ts propose|execute|cancel|set-delay|lock
  --signers a,b` signs with local identities. `execute` reads the pending proposal, prints its
  hash, `eta` and `expires_at`, and commits the signatures to that hash.
- The credential format, legacy `ADDRESS` or `ADDRESS_V2`, is whatever the network's own recording
  simulation produces, not assumed from the SDK.
- Because the transaction itself is always valid, an under-signed call is included in a ledger and
  fails there. The demo uses that to record a refused 1-of-3 proposal on-chain.
- `stellar contract invoke` (CLI 28) signs with a single key (`--sign-with-key`) and has no option
  to combine several signers' signatures into one auth entry, hence a TypeScript script.
  `scripts/upgrade.sh` delegates every admin call to it.

## Versions

- `VERSION` (returned by `version()`) bumps with **every** release.
- `STORAGE_VERSION` bumps with **every storage layout change**, and "layout change" is defined
  broadly below: any new key, variant or field counts. The stored value, `storage_version()`, lives
  in instance storage under `DataKey::StorageVersion`.
- Both numbers are also embedded in the wasm as metadata (`contractmeta!` keys `sisonke_version` and
  `sisonke_storage_version` in `lib.rs`), so `upgrade.sh` can read them from a file before proposing
  it. Bump the literals together with the constants; the `wasm_meta_matches_version_constants` test
  fails otherwise.
- While the stored value differs from the running code's `STORAGE_VERSION`, every escrow write and
  `lock_upgrades` return `MigrationRequired` (141). Reads, the TTL bumps, `set_paused`, the admin
  handover and the upgrade functions keep working, so a fix can always be shipped.
  - **This blocks exits too** (`release`, `refund`, `reclaim`, `dispute`, `resolve`) until
    `migrate` runs.
  - **The window is normally seconds.** `migrate` is permissionless, so anyone can call it
    immediately after the upgrade lands (`upgrade.sh execute` with `MIGRATE=1` does).
  - **If the migration itself is broken, the remedy is upgrading forward** to fixed code, which
    still waits a full delay. That is why migrations are rehearsed on a copy of real data before
    they are proposed.
- v1 is a fresh pre-release deployment, so the timelock keys below are part of layout **1**
  (`STORAGE_VERSION` stays 1). From now on, adding anything is a layout change.
- **The superseded instant-upgrade Testnet instance
  `CDYJ6GNKZCXTBSDETHTQDUTAYHLM577N46BQW4FU3ITDFMGDG3JJD2NY` must never be upgraded to this code.**
  It has no `UpgradeDelay` key (the delay would fall back to the 30-day maximum), and its escrows
  were indexed for the recipient and arbiter at creation, so funding one under this code would
  list it twice. It is history only; deploy fresh (`FORCE=1 make deploy`).

## Storage ABI: what is frozen

These names and types **are** the stored encoding. Never rename, remove, or change the type of:

| What | Why it is frozen |
|---|---|
| Every `DataKey` variant name: `Admin`, `PendingAdmin`, `Token`, `NextId`, `TotalLocked`, `Paused`, `UpgradesLocked`, `StorageVersion`, `Escrow`, `PartyCount`, `PartyPage`, `UpgradeDelay`, `PendingUpgrade` | A variant is stored as `[Symbol(name), fields…]`; a renamed key no longer finds its data |
| The field types of those variants: `Escrow(u64)`, `PartyCount(Address, PartyRole)`, `PartyPage(Address, PartyRole, u32)` | They are part of the key |
| Every `PartyRole` variant name: `Payer`, `Recipient`, `Arbiter` | Part of every index key; renaming one orphans every index |
| Every `Status` variant name: `Created`, `Funded`, `Disputed`, `Released`, `Refunded`, `Split`, `Cancelled` | Stored in every `Escrow` |
| Every `Escrow` field name **and type** (`id: u64`, `payer: Address`, `recipient: Address`, `arbiter: Option<Address>`, `token: Address`, `amount: i128`, `deadline: u64`, `title: String`, `terms_hash: Option<BytesN<32>>`, `status: Status`, `created_at: u64`, `created_ledger: u32`, `funded_at: u64`, `disputed_at: u64`, `disputed_by: Option<Address>`, `closed_at: u64`, `closed_by: Option<Address>`, `paid_to_recipient: i128`, `paid_to_payer: i128`, `updated_ledger: u32`) | A struct is stored as a map keyed by field name |
| Every `PendingUpgrade` field name and type (`wasm_hash: BytesN<32>`, `proposed_at: u64`, `eta: u64`, `expires_at: u64`) | Stored under `PendingUpgrade`; a new version must still read a proposal made by the old one |
| The value types of the instance keys (`Address`, `u64`, `i128`, `bool`, `u32` as in CONTRACT.md "Storage") and of the index entries (`u32`, `Vec<u64>`) | Decoding a different type fails |
| `EscrowView`, `ContractInfo` field names and every event's topics and field names | Not stored, but they are the client and indexer ABI |

**The rule: any new `DataKey` variant, any new `Status` or `PartyRole` variant, any new `Escrow` (or
`PendingUpgrade`) field, and any type change is a storage layout change. It bumps `STORAGE_VERSION`
and ships a `migrate`.** This is stricter than "new fields must be `Option<T>`" alone, and it has to
be. Old code decodes a struct map by field name and silently ignores keys it doesn't know. If a v2
added an optional field without a bump and was then rolled back, v1's next write to that record would
re-encode it **without** the field, losing the data without any error. With the bump, rolled-back v1
sees a newer stored layout and refuses every write (141) instead, so a lossy rollback can't happen.

New fields must still be `Option<T>` (SDK ≥ 28 decodes a missing field as `None`), so records
written before the migration decode in the new code. A field is only removed through a migration that
rewrites every record.

Every version keeps `propose_upgrade(BytesN<32>)`, `upgrade(BytesN<32>)`, `cancel_upgrade()` (admin-gated,
timelocked with expiry, hash-bound, honouring `UpgradesLocked`), `lock_upgrades`, `upgrade_delay`,
`pending_upgrade`, the admin functions, `version`, `storage_version`, `migrate` and the escrow
functions. `upgrade.sh` refuses a wasm that doesn't export them **with these parameter types**. That
catches a v2 that drops the hash argument or changes a signature. It can't tell what a function
does with its arguments (an instant `upgrade(new_wasm_hash)` would have the same types), so the
diff still needs review.

## Shipping a v2

1. Write the change. Bump `VERSION` and its `contractmeta!` literal. If the layout changes (see above),
   bump `STORAGE_VERSION` and its literal and write `migrate` (pattern below).
2. Commit, then `make check` (fmt, clippy, every test, including the compiled-wasm upgrade and rollback tests).
3. **Propose** (`make upgrade-propose`, or):

   ```sh
   scripts/upgrade.sh propose                         # builds the current source, checks it, uploads it, proposes it
   WASM=path/to/v2.wasm scripts/upgrade.sh propose    # a specific wasm
   ADMIN_SIGNERS=sisonke-admin-signer-1,sisonke-admin-signer-3 scripts/upgrade.sh propose
   ```

   Before sending anything, `upgrade.sh propose`:
   - checks that upgrades are not locked, and shows the admin, the current code hash, versions,
     delay and any pending proposal (which this one would replace, restarting the delay);
   - refuses the test-only upgrade fixture unless `ALLOW_FIXTURE=1` (only `upgrade-demo.sh` sets it, for
     its throwaway instance; the demo script also refuses to target the main deployment);
   - runs `stellar contract info interface --wasm` and refuses a wasm that doesn't export every function
     listed above with the listed parameter types;
   - reads `sisonke_version` / `sisonke_storage_version` from the wasm metadata and requires the version
     to go up (unless `ROLLBACK=1`), and the storage version to be the stored one or the next one
     (migrations can't skip versions; going down needs `ROLLBACK=1` and prints a warning that writes
     will be blocked);
   - asks you to type `propose` (or `YES=1`), uploads the wasm (its hash must equal the local file's),
     and proposes it with the admin's signers (`scripts/admin.ts`). It prints the `eta`.
   With independent signers, use `admin.ts prepare propose <hash>`, `sign`, `submit` instead (see
   "How the scripts sign").
4. **Announce** the proposal (hash, `eta`, `expires_at`, what changed). Users who distrust it settle
   their escrows before `eta`: toward the counterparty before the deadline, or by `reclaim` after it.
5. **Execute** between `eta` and `expires_at` (`make upgrade-execute`, or
   `MIGRATE=1 scripts/upgrade.sh execute`). It:
   - refuses before the eta and after the expiry;
   - asks you to type `execute`;
   - runs `upgrade(<pending hash>)` with the signers, so the signatures commit to that hash;
   - fetches the live code and requires its hash to equal the proposed one;
   - runs `migrate` if `MIGRATE=1`, so exits are blocked only for those seconds;
   - updates `SISONKE_WASM_HASH` in `deployments/<network>.env`.

   `scripts/upgrade.sh cancel` withdraws a proposal. Missed the window? Propose again; the delay
   restarts.
6. Anyone can verify the new code: `stellar contract fetch --id <CONTRACT_ID> --network testnet | shasum -a 256`
   equals the hash in the `upgrade_proposed` / `upgraded` events, and a reproducible build of the
   tagged source gives the same hash. `deploy.sh` records the source revision (`git describe --dirty`)
   in the env file and refuses an uncommitted tree off Testnet.

**Rollback** is a proposal of the old wasm: `WASM=old.wasm ROLLBACK=1 scripts/upgrade.sh propose`,
then `execute` after the delay. It works cleanly before the new version's `migrate` has run. After a
migration, the old code sees a stored `storage_version` newer than its own and refuses every write
(141) while reads keep working. That is intended: old code must never write data in a layout it doesn't
understand. Recover by upgrading forward again (still possible: `propose_upgrade` and `upgrade` don't
need the storage to be current).

## The `migrate` pattern (v2 and later)

```text
migrate():                        // permissionless: no require_auth
  stored = StorageVersion
  if stored == STORAGE_VERSION     -> Err(NothingToMigrate)
  if stored != STORAGE_VERSION - 1 -> Err(MigrationRequired)    // no skipping versions
  transform the data (bounded work per call; a large transform keeps a cursor key and
                      runs over several calls, setting StorageVersion only at the end)
  StorageVersion = STORAGE_VERSION
  emit ("sisonke", "migrated") { from: stored, to: STORAGE_VERSION }
```

`migrate` is permissionless so a migration can be finished even if the admin key is lost, and so a
half-migrated contract can never be stuck. It is idempotent: a second call returns `NothingToMigrate`.
v1 has no older layout, so its `migrate` always returns `NothingToMigrate` (or `MigrationRequired` if it
was rolled back to after a newer migration). A migration that can fail or run out of budget blocks
exits until fixed, so test it against a copy of real data before shipping.

## How this is tested

`contracts/upgrade-fixture` is a test-only "v2" (`version() == 2`, `STORAGE_VERSION` 2). It copies
**every** v1 `DataKey` variant, plus `Status`, `PartyRole`, `Escrow` and `PendingUpgrade`, by hand
rather than importing them, so if v1's stored layout drifts, decoding fails and the tests catch it. It
keeps the same timelocked `propose_upgrade` / `upgrade` / `cancel_upgrade` / `lock_upgrades`, so tests
can upgrade back out of it. It adds one new key, `FixtureMarker`, and so bumps the storage version, as
the rule above requires. Its committed build, `contracts/sisonke-escrow/testdata/upgrade_fixture.wasm`,
is reproduced byte for byte by `make fixture`. Never deploy it to the production instance.

- `test/timelock.rs`:
  - constructor bounds, and an upgrade refused at `eta - 1` and allowed at `eta`;
  - `upgrade` requires the pending hash, and the check order is 203 → 206 → 204;
  - the 7-day window is inclusive at `expires_at`, refused one second later, and an expired
    proposal can be cancelled;
  - raising the delay moves a pending `eta`, and the event carries it;
  - replacing a proposal emits `upgrade_cancelled` first;
  - non-admins can't propose, cancel, execute or change the delay;
  - replacing a proposal restarts the delay, and a cancelled proposal can't run;
  - `lock_upgrades` clears the proposal and blocks new ones;
  - the delay only increases, within bounds;
  - **every exit works while an upgrade is pending**;
  - a handover cancels the old proposal, and the new admin waits a full delay;
  - exact events.
- `test/upgrade.rs` (native v1 → fixture, through propose → wait → upgrade):
  - address, storage and funds survive; the fixture decodes every escrow status, the admin, pending
    admin, token, pause flag, delay and every party index page and count;
  - only the admin can upgrade, and unknown hashes fail;
  - `lock_upgrades` is permanent across an admin handover;
  - a storage-version mismatch blocks writes but not proposing a fix;
  - the fixture's `migrate` runs once, and its metadata says version 2 / storage 2.
- `test/wasm.rs` (compiled v1, `make test`):
  - the timelock against the real fixture wasm (too early at `eta - 1`, an exit during the delay, the
    upgrade at `eta`), with the fixture implementing the same `upgrade(expected_hash)` and expiry;
  - upgrade to the fixture and roll back through its own timelock before migrating (escrows then
    settle normally);
  - roll back after migrating (v1 writes return 141, reads work, upgrading forward works);
  - the wasm metadata matches `VERSION` / `STORAGE_VERSION`.
- `test/model.rs` proposes and cancels upgrades at random among the escrow operations; every
  prediction about what users can do holds whether or not an upgrade is pending.
- `test/adversary_timelock.rs` attacks the timelock, the handover around it and the fund-time
  index. Four of its findings were fixed in the contract, and their tests now assert the fix:
  - hash binding (`upgrade_signature_is_bound_to_the_hash`);
  - expiry (`stale_proposal_expires_after_the_window`);
  - delay push (`raising_the_delay_pushes_the_pending_eta`);
  - the missing-key fallback (`missing_upgrade_delay_key_falls_back_to_the_max_delay`).

The multisig signing path (`scripts/admin.ts`) is exercised on Testnet by `make upgrade-demo`.

## Trust model

1. **The admin can upgrade the code after a public delay; during it, either party can move each
   escrow's funds out of the new code's reach.**
   - While `upgrades_enabled() == true`, the admin can install code that moves every locked token,
     but only from `upgrade_delay()` to `upgrade_delay() + 7 days` after proposing its hash, and
     only with signatures committed to that hash. The delay can only grow.
   - Before an escrow's deadline its funds can only go toward the counterparty or through the
     arbiter; the payer alone can reclaim only after the deadline. Deadlines shorter than the delay
     give a unilateral exit.
   - Mitigations: multisig admin (verified M-of-N), two-step handover (which also cancels a pending
     proposal), events with the wasm hash, and `lock_upgrades`, which is permanent and survives
     admin changes.
2. **Without upgrades, the admin can't touch funds.** `set_paused` only blocks inflows.
3. **Future versions are trusted to follow the rules on this page** (keep the timelocked upgrade
   functions honouring `UpgradesLocked`, keep the storage guard, bump `STORAGE_VERSION` on every
   layout change). Nothing on-chain enforces this before the lock; `upgrade.sh` checks what it can
   (exports, versions, hash).
4. **The multisig's signers.** Whoever controls M of the N signer keys is the admin. Keep the keys
   with different people and devices on mainnet: generate them there, give `multisig-admin.sh` only
   the public keys, and sign with `admin.ts prepare` / `sign` / `submit`. Rotate them with
   `set-options` signed by M signers, then re-run `multisig-admin.sh verify`.

The admin's powers are `set_paused`, the admin handover, the upgrade functions and `lock_upgrades`.
That's the whole list. `set_paused` keeps working after `lock_upgrades` (it only ever blocks inflows),
and the admin role can't be renounced.

## Testnet upgrade proof

`make upgrade-demo` (scripts/upgrade-demo.sh) runs the whole flow on a **separate** instance
(`ALIAS=sisonke-upgrade-demo`). It never touches the main instance. The steps:
1. Create a 2-of-3 multisig admin (`sisonke-demo-admin`) and deploy with a 60 s delay.
2. Lock 1 USDC with `create_and_fund`.
3. Propose the fixture with **one** signer, which must fail on-chain.
4. Propose it with two signers.
5. Execute **before the eta**, which must fail on-chain (204). The delay is only 60 s, so a very slow
   RPC could reach the eta first; the demo then stops, which is safe, and can simply be re-run.
6. Wait for the eta, then execute with a **wrong expected hash**, which must fail on-chain (206).
7. Execute with the right hash, then migrate.
8. Read `version` (2), the escrow, `total_locked` and the SAC balance.
9. Record every transaction hash below.

**The demo's 1 USDC is permanently stranded on the demo instance, by design.** The fixture has no
payout functions (no `release`, `refund`, `reclaim` or `resolve`), and after its `migrate` the stored
layout is 2. Upgrading back to v1 would not help either, because v1 refuses every write on layout-2
data (141). Getting the funds out would need a purpose-built version for layout 2 with payout
functions, which isn't worth 1 Testnet USDC. Never point the demo at an instance holding real funds;
`upgrade-demo.sh` refuses the main deployment's id.

Each run adds a block above the marker below.

**2026-10-29**: demo contract [`CDEA3U5B2M4TPOSUBFUKRICKAK5AF5SLIZCMJRESWHB3XSYXMYREZZJQ`](https://stellar.expert/explorer/testnet/contract/CDEA3U5B2M4TPOSUBFUKRICKAK5AF5SLIZCMJRESWHB3XSYXMYREZZJQ), admin [`GBPSNZCXM52MAACKJAGZE3UIE2Y7SZ5REH452AFPG2372HF52CQBQ42F`](https://stellar.expert/explorer/testnet/account/GBPSNZCXM52MAACKJAGZE3UIE2Y7SZ5REH452AFPG2372HF52CQBQ42F) (2-of-3), delay 60 s, v1 wasm `99693d7da2c0ebb52043e97ca8342590b296b5aa83f6d682d345c3d627a34aad`, fixture wasm `9313ce207634353c8370edf79a877b664c8674bf9432735bd55dae905f3f7706`, escrow #1: total_locked 10000000 → 10000000, contract USDC 10000000, version / storage 2 / 2.

| Step | Signers | Expected | Result | Transaction |
|---|---|---|---|---|
| propose_upgrade, 1 signer | 1 of 3 | refused: signer weight below threshold | ⛔ Auth error (code 6) | [`6c8dc2b3…`](https://stellar.expert/explorer/testnet/tx/6c8dc2b37d16f612b92a57bed5eac3c822fbad082f42adc5f4506a07713167d3) |
| propose_upgrade, 2 signers | 2 of 3 | ok, eta = now + 60 s | ✅ eta 1793236870 | [`0da40164…`](https://stellar.expert/explorer/testnet/tx/0da40164def3ad3e1f2f63072cb191f618e073e4b90948af7f889735ef07fa4a) |
| upgrade before eta | 2 of 3 | refused: UpgradeTooEarly (204) | ⛔ Error #204 UpgradeTooEarly | [`7e0e91cb…`](https://stellar.expert/explorer/testnet/tx/7e0e91cb264dc429f91f30b9b6f01dbd0ac5ee28cba2377af7606bb6cebbd13e) |
| upgrade(wrong hash) after eta | 2 of 3 | refused: UpgradeHashMismatch (206) | ⛔ Error #206 UpgradeHashMismatch | [`ac8b4043…`](https://stellar.expert/explorer/testnet/tx/ac8b4043b0d3d106c6d2d943813d862385689d3b4916feb6186ddb4d6dc46ff7) |
| upgrade at eta (+ migrate) | 2 of 3 | ok, version 2, storage 2 | ✅ upgraded | [`7b0c608b…`](https://stellar.expert/explorer/testnet/tx/7b0c608b09dfea0eb3ca4039a35c7f421fcac0a0e5e5483669ebdb28b1fc868c) |

<!-- upgrade-demo rows -->

### Earlier run: instant-upgrade build (before the timelock and multisig)

Superseded by the timelocked, multisig build; kept as history. That build ran an instant
`upgrade(hash)` signed by a single deployer key.

| Date | Demo contract | v1 wasm hash | Fixture wasm hash | Escrow | total_locked before → after | SAC balance | version / storage_version |
|---|---|---|---|---|---|---|---|
| 2026-10-28 | [`CCGKH2KVP4EYOGP7Y7TKQHD2XIXWRSV2IJ5MZV7UYMGN22GUTXYOCQAE`](https://stellar.expert/explorer/testnet/contract/CCGKH2KVP4EYOGP7Y7TKQHD2XIXWRSV2IJ5MZV7UYMGN22GUTXYOCQAE) | `52c4582ba0c919df6e7e00c92f0f2c77fa5ebc384beffdcdaa36238e80fe6361` | `075e35d70e729f385b3330cffe365220bacafe83980e2a0d38965f2552786524` | #1 | 10000000 → 10000000 | 10000000 | 2 / 2 |
