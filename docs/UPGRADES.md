# Upgrading sisonke-escrow

sisonke-escrow upgrades the way Solidity's UUPS proxies do, without a proxy: the upgrade
function lives in the contract itself, and swapping the code keeps the contract address, all
storage and every locked token. This page is how to ship a v2, the rules a new version must
follow, and the trust model. The contract reference is [CONTRACT.md](CONTRACT.md).

> **Trust assumption #1: upgrades are instant and total.** In v1, one admin signature on
> `upgrade(hash)` installs new code at once. There is no timelock and no second approver, and new
> code can move every locked token, so users get no window to exit before it runs. Until
> `lock_upgrades()` is called, trusting a Sisonke instance means trusting its admin key.
>
> Mitigations, in order of strength:
> 1. **`lock_upgrades()`** once the code is final. It is permanent and survives every admin change;
>    after it, nobody (including any future admin) can change the code.
> 2. **A multisig admin**: a Stellar account with weighted signers and a threshold, or a contract
>    account. `deploy.sh` refuses to make the deployer's own CLI key the admin off Testnet.
> 3. **Transparency**: every upgrade emits `upgraded {new_wasm_hash, from_version}`. Anyone can
>    `stellar contract fetch` the live code and compare its hash with a reproducible build.
> 4. **Two-step handover** (`propose_admin` → `accept_admin`), so a typo can't lose the role.
>
> An upgrade timelock (`propose_upgrade`, then `upgrade` only after a delay) is deferred to v2.

## Mapping to UUPS / OpenZeppelin

| UUPS / OZ | Sisonke |
|---|---|
| `upgradeTo(impl)` in the implementation | `upgrade(new_wasm_hash)` in the contract itself: `update_current_contract(ContractExecutable::Wasm(..))` |
| `_authorizeUpgrade onlyOwner` | `Admin.require_auth()` |
| proxy keeps storage + balance | same contract address; storage and SAC balances untouched |
| `upgradeToAndCall` | `upgrade` transaction, then a `migrate()` transaction (Soroban has no self re-entry). Escrow writes are refused until migrated. |
| final implementation without upgrade | `lock_upgrades()`, permanent; every future version must keep honouring `UpgradesLocked` |
| `Ownable2Step` | `propose_admin` → `accept_admin`, `cancel_admin_proposal` |

`upgrade` only accepts a plain wasm hash. `ContractExecutable::ExternalRef` is never used: it would hand
control of the code to whoever owns the referenced entry.

## Versions

- `VERSION` (returned by `version()`) bumps with **every** release.
- `STORAGE_VERSION` bumps with **every storage layout change**, and "layout change" is defined
  broadly below: any new key, variant or field counts. The stored value, `storage_version()`, lives
  in instance storage under `DataKey::StorageVersion`.
- Both numbers are also embedded in the wasm as metadata (`contractmeta!` keys `sisonke_version` and
  `sisonke_storage_version` in `lib.rs`), so `upgrade.sh` can read them from a file before installing it.
  Bump the literals together with the constants; the `wasm_meta_matches_version_constants` test fails
  otherwise.
- While the stored value differs from the running code's `STORAGE_VERSION`, every escrow write and
  `lock_upgrades` return `MigrationRequired` (141). Reads, the TTL bumps, `set_paused`, the admin handover
  and `upgrade` keep working, so a fix can always be shipped. **This blocks exits too** (`release`,
  `refund`, `reclaim`, `dispute`, `resolve`) until `migrate` runs. `migrate` is permissionless, so
  anyone can end that state.

## Storage ABI: what is frozen

These names and types **are** the stored encoding. Never rename, remove, or change the type of:

| What | Why it is frozen |
|---|---|
| Every `DataKey` variant name: `Admin`, `PendingAdmin`, `Token`, `NextId`, `TotalLocked`, `Paused`, `UpgradesLocked`, `StorageVersion`, `Escrow`, `PartyCount`, `PartyPage` | A variant is stored as `[Symbol(name), fields…]`; a renamed key no longer finds its data |
| The field types of those variants: `Escrow(u64)`, `PartyCount(Address, PartyRole)`, `PartyPage(Address, PartyRole, u32)` | They are part of the key |
| Every `PartyRole` variant name: `Payer`, `Recipient`, `Arbiter` | Part of every index key; renaming one orphans every index |
| Every `Status` variant name: `Created`, `Funded`, `Disputed`, `Released`, `Refunded`, `Split`, `Cancelled` | Stored in every `Escrow` |
| Every `Escrow` field name **and type** (`id: u64`, `payer: Address`, `recipient: Address`, `arbiter: Option<Address>`, `token: Address`, `amount: i128`, `deadline: u64`, `title: String`, `terms_hash: Option<BytesN<32>>`, `status: Status`, `created_at: u64`, `created_ledger: u32`, `funded_at: u64`, `disputed_at: u64`, `disputed_by: Option<Address>`, `closed_at: u64`, `closed_by: Option<Address>`, `paid_to_recipient: i128`, `paid_to_payer: i128`, `updated_ledger: u32`) | A struct is stored as a map keyed by field name |
| The value types of the instance keys (`Address`, `u64`, `i128`, `bool`, `u32` as in CONTRACT.md "Storage") and of the index entries (`u32`, `Vec<u64>`) | Decoding a different type fails |
| `EscrowView`, `ContractInfo` field names and every event's topics and field names | Not stored, but they are the client and indexer ABI |

**The rule: any new `DataKey` variant, any new `Status` or `PartyRole` variant, any new `Escrow` field,
and any type change is a storage layout change. It bumps `STORAGE_VERSION` and ships a `migrate`.**
This is stricter than "new fields must be `Option<T>`" alone, and it has to be. Old code decodes an
`Escrow` map by field name and silently ignores keys it doesn't know. If a v2 added an optional field
without a bump and was then rolled back, v1's next write to that escrow would re-encode it **without**
the field, losing the data without any error. With the bump, rolled-back v1 sees a newer stored layout
and refuses every write (141) instead, so a lossy rollback can't happen.

New `Escrow` fields must still be `Option<T>` (SDK ≥ 28 decodes a missing field as `None`), so records
written before the migration decode in the new code. A field is only removed through a migration that
rewrites every record.

Every version keeps `upgrade` (admin-gated, honouring `UpgradesLocked`), `lock_upgrades`, the admin
functions, `version`, `storage_version`, `migrate` and the escrow functions. `upgrade.sh` refuses a wasm
that doesn't export them.

## Shipping a v2

1. Write the change. Bump `VERSION` and its `contractmeta!` literal. If the layout changes (see above),
   bump `STORAGE_VERSION` and its literal and write `migrate` (pattern below).
2. Commit, then `make check` (fmt, clippy, every test, including the compiled-wasm upgrade and rollback tests).
3. Upgrade the deployed contract:

   ```sh
   scripts/upgrade.sh                       # builds the current source, checks it, uploads it, calls upgrade
   MIGRATE=1 scripts/upgrade.sh             # ...and runs migrate in the next transaction
   WASM=path/to/v2.wasm scripts/upgrade.sh  # a specific wasm
   ```

   Before sending anything, `upgrade.sh`:
   - checks that `SOURCE` is the admin and that upgrades are not locked;
   - refuses the test-only upgrade fixture unless `ALLOW_FIXTURE=1` (only `upgrade-demo.sh` sets it, for
     its throwaway instance; the demo script also refuses to target the main deployment);
   - runs `stellar contract info interface --wasm` and refuses a wasm that doesn't export every function
     listed above;
   - reads `sisonke_version` / `sisonke_storage_version` from the wasm metadata and requires the version
     to go up (unless `ROLLBACK=1`), and the storage version to be the stored one or the next one
     (migrations can't skip versions; going down needs `ROLLBACK=1` and prints a warning that writes
     will be blocked);
   - shows network, contract, current and new code hash and versions, and asks you to type `upgrade`
     (or `YES=1`).

   After the upgrade it fetches the live code and requires its hash to equal the uploaded one, checks
   `version()`, runs `migrate` if `MIGRATE=1` and verifies `storage_version()`, and updates
   `SISONKE_WASM_HASH` in `deployments/<network>.env`.
4. Anyone can verify the new code: `stellar contract fetch --id <CONTRACT_ID> --network testnet | shasum -a 256`
   equals the hash in the `upgraded` event, and a reproducible build of the tagged source gives the
   same hash. `deploy.sh` records the source revision (`git describe --dirty`) in the env file and
   refuses an uncommitted tree off Testnet.

**Rollback** is an upgrade to the old wasm: `WASM=old.wasm ROLLBACK=1 scripts/upgrade.sh`. It works
cleanly before the new version's `migrate` has run. After a migration, the old code sees a stored
`storage_version` newer than its own and refuses every write (141) while reads keep working. That is
intended: old code must never write data in a layout it doesn't understand. Recover by upgrading
forward again.

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
**every** v1 `DataKey` variant, plus `Status`, `PartyRole` and `Escrow`, by hand rather than importing
them, so if v1's stored layout drifts, decoding fails and the tests catch it. It adds one new key,
`FixtureMarker`, and so bumps the storage version, as the rule above requires. Its committed build,
`contracts/sisonke-escrow/testdata/upgrade_fixture.wasm`, is reproduced byte for byte by
`make fixture`. Never deploy it to the production instance.

- `test/upgrade.rs` (native v1 → fixture): address, storage and funds survive. The fixture decodes
  every escrow status, the admin, pending admin, token, pause flag and every party index page and count.
  Only the admin can upgrade; unknown hashes fail; `lock_upgrades` is permanent across an admin handover;
  a storage-version mismatch blocks writes; the fixture's `migrate` runs once; its metadata says
  version 2 / storage 2.
- `test/wasm.rs` (compiled v1, `make test`): upgrade to the fixture and roll back before migrating
  (escrows then settle normally); roll back after migrating (v1 writes return 141, reads work, upgrading
  forward works); the wasm metadata matches `VERSION` / `STORAGE_VERSION`.

## Trust model

1. **Upgrade power is total.** While `upgrades_enabled() == true`, the admin can install code that moves every
   locked token. Users trust the admin key the way they'd trust a UUPS owner. Mitigations: two-step handover;
   `upgraded` event with the wasm hash (anyone can `stellar contract fetch` it and diff it against a reproducible build); `lock_upgrades`
   is permanent and survives admin changes; recommended a multisig admin and a lock before mainnet. A timelock is deferred to v2.
2. **Without upgrades, the admin can't touch funds.** `set_paused` only blocks inflows.
3. **Future versions are trusted to follow the rules on this page** (keep `upgrade` honouring
   `UpgradesLocked`, keep the storage guard, bump `STORAGE_VERSION` on every layout change). Nothing
   on-chain enforces this before the lock; `upgrade.sh` checks what it can (exports, versions, hash).

The admin is a single `Address`, which may be a multisig account or a contract. Its powers are
`set_paused`, the admin handover, `upgrade` and `lock_upgrades`. That's the whole list. `set_paused`
keeps working after `lock_upgrades` (it only ever blocks inflows), and the admin role can't be renounced.

## Testnet upgrade proof

`make upgrade-demo` (scripts/upgrade-demo.sh) deploys a **separate** instance
(`ALIAS=sisonke-upgrade-demo`), locks 1 USDC in it with `create_and_fund`, upgrades it to the fixture
with `MIGRATE=1`, then reads `version` (2), the escrow, `total_locked` and the SAC balance, and appends a
row here. It never touches the main instance.

**The demo's 1 USDC is permanently stranded on the demo instance, by design.** The fixture has no
payout functions (no `release`, `refund`, `reclaim` or `resolve`), and after its `migrate` the stored
layout is 2. Upgrading back to v1 would not help either, because v1 refuses every write on layout-2
data (141). Getting the funds out would need a purpose-built version for layout 2 with payout
functions, which isn't worth 1 Testnet USDC. Never point the demo at an instance holding real funds;
`upgrade-demo.sh` refuses the main deployment's id.

| Date | Demo contract | v1 wasm hash | Fixture wasm hash | Escrow | total_locked before → after | SAC balance | version / storage_version |
|---|---|---|---|---|---|---|---|
| 2026-10-28 | [`CCGKH2KVP4EYOGP7Y7TKQHD2XIXWRSV2IJ5MZV7UYMGN22GUTXYOCQAE`](https://stellar.expert/explorer/testnet/contract/CCGKH2KVP4EYOGP7Y7TKQHD2XIXWRSV2IJ5MZV7UYMGN22GUTXYOCQAE) | `52c4582ba0c919df6e7e00c92f0f2c77fa5ebc384beffdcdaa36238e80fe6361` | `075e35d70e729f385b3330cffe365220bacafe83980e2a0d38965f2552786524` | #1 | 10000000 → 10000000 | 10000000 | 2 / 2 |
<!-- upgrade-demo rows -->

Rows are appended by `make upgrade-demo`; the table stays empty until it has run.
