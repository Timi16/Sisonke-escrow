# sisonke-escrow security audit (v1)

| | |
|---|---|
| Target | `sisonke-escrow` v1 (`version() == 1`, `storage_version() == 1`), Soroban, `soroban-sdk` 29.0.1, Rust 1.99.1, `wasm32v1-none` |
| Date | 2026-10-29 |
| Type | Manual review: specification conformance, Soroban host/SDK semantics, upgrade and operations safety |
| Specification | [PLAN.md](PLAN.md) (design, §3 functions, §4 rules, §8 invariants I1–I19), [CONTRACT.md](CONTRACT.md) (user-facing rules), [UPGRADES.md](UPGRADES.md) |
| Result | **No Critical or High findings.** 1 Medium (centralised upgrade authority, a documented trust assumption, made worse by the deploy defaults), 6 Low, 9 Informational |

## 1. Scope

The repository has no commits yet (`git log` reports an empty `main`), so the code under review is
identified by SHA-256 file hashes instead of a commit:

| File | Lines | SHA-256 |
|---|---|---|
| `contracts/sisonke-escrow/src/lib.rs` | 713 | `ac8756c51e19cd047220541755084fecfa79edd35a94aec5866828f592b662b7` |
| `contracts/sisonke-escrow/src/storage.rs` | 226 | `0daa1fa288276c8464a1c7b66c75fc362c1243ac62776f85f48c8b614c09c8e0` |
| `contracts/sisonke-escrow/src/types.rs` | 141 | `439de0205e7ade2cc9be1cf031409b4628465184f9c3c6c034700fb710632ee7` |
| `contracts/sisonke-escrow/src/errors.rs` | 59 | `d4ed57fa16bbbaf4ed97667ffae3e0e1f93df6a44eda730851f575bbf222d747` |
| `contracts/sisonke-escrow/src/events.rs` | 291 | `73c2f6361486e50602631f4216170b7f6c0c888b4e8df444b578950e6789094f` |
| `contracts/upgrade-fixture/src/lib.rs` | 195 | `c710128fca0b5845344732f7e59175a18aeb1f4a026c62c47231f243a6f93d4a` |
| `contracts/sisonke-escrow/testdata/upgrade_fixture.wasm` | n/a | `ae63d3cbbdbb1cde798ecb154e4faf5cd838529e5ef38c352b4cf565332b69b6` |
| `scripts/deploy.sh` | 144 | `0384a0ec667adefe91b08f205f357e4cccfcd43ed424eb3d0401500e21f53bdb` |
| `scripts/upgrade.sh` | 95 | `ab17099d1e49aee281284a4c2f530dfedc53b91fd34d343bfcb9d1e7815d3ecf` |
| `scripts/upgrade-demo.sh` | 97 | `ac6e91a42bab9cacff1aaa362fee8a2959382c8dc8152da07b88e6a8530f1686` |
| `Cargo.toml` (workspace, release profile) | | `c51f1ea48175e11793db6cc8564fe4403566183a35a0459118abd67221a4d136` |
| `rust-toolchain.toml` | | `4033257ab6e2d0b0fc813e027f522213dc9ed08d337a3b2a36638201e716da79` |
| `Cargo.lock` (pins `soroban-sdk` 29.0.1) | | `35be7f5e66e8020f15edadc1c259035c3ee064e5ba98d67b23f2b564e9ac11d3` |
| `contracts/sisonke-escrow/Cargo.toml` | | `a6f36d2a4eb96c8c6ce6de5688bb9eba894ebbc1141f40098865cf4a751ed1ec` |
| `contracts/upgrade-fixture/Cargo.toml` | | `1aa7f0c46ce5939559319c802654f70b924777da766bc82b3f5f44136bc7f647` |

**Out of scope:** `scripts/e2e.ts`, `scripts/bindings.sh`, the web app, the test suites
(`src/test/*.rs`; they were run but not audited, and the concurrently written `src/test/adversary.rs`
was ignored), the Stellar Asset Contract and the Soroban host. SDK and host behaviour was checked
against source, not assumed (§2).

## 2. Methodology

1. Read every in-scope source file line by line, independently of the docs and tests, and rebuilt the
   state machine, auth requirements, check order, effects, transfers and events for each public function.
2. Compared each function with PLAN.md §3.0 (execution order), §3.2–3.4 (tables) and §4 (rules matrix),
   and each of the 19 invariants in PLAN.md §8 with the code paths that have to uphold it (§5 below).
3. Checked Soroban semantics the design depends on in the vendored sources
   (`~/.cargo/registry/src/*/soroban-sdk-29.0.1`, `soroban-sdk-macros-29.0.1`, `soroban-env-host-29.0.1`):
   - **Error returns roll back.** `soroban-env-host` `host/frame.rs:518-545`: a contract function that
     returns `Ok(Error)` with a contract error type is turned into a failure, and `with_frame` rolls back
     storage and events (`frame.rs:607-612`). A top-level failure discards the whole transaction. So
     "write state, then transfer, then maybe `Err(TransferMismatch)`" is atomic.
   - **Self-authorization is impossible.** `auth.rs:1165-1222`: a contract can't authorize its own
     address through invoker auth, and with address credentials a contract address needs `__check_auth`,
     which this contract lacks. An admin or payer equal to the contract can never sign.
   - **Upgrades.** `Deployer::update_current_contract(ContractExecutable::Wasm(h))` (SDK `deploy.rs:313`)
     requires `h` to be uploaded already and applies only after the invocation succeeds.
     `ExternalRef` is never built.
   - **TTL.** `instance().extend_ttl` extends instance **and** code (SDK `storage.rs:631`). The host extends
     when `current_ttl <= threshold` and clamps persistent entries to the network maximum instead of failing
     (`env-host storage.rs:588-622`).
   - **`#[contracttype]` structs** are encoded as symbol-keyed maps with sorted keys and decoded with
     `sparse_map_unpack_to_slice` (macros `derive_struct.rs:128-138`, host `data_helper.rs:853-960`,
     protocol ≥ 28): a **missing** field decodes as `Void`, so `None` for `Option`, and an **unknown
     extra** field is silently ignored (this matters for SIS-06).
   - **`soroban_sdk::String`** is raw bytes; the host doesn't validate UTF-8 (this matters for SIS-07).
4. Reviewed `Cargo.toml`: release profile `overflow-checks = true`, `panic = "abort"`, `lto`,
   `codegen-units = 1`. `release-with-logs` inherits these.
5. Reviewed the deploy and upgrade scripts for wrong network, wrong admin, wrong wasm, unchecked outputs and
   idempotency.
6. Ran `cargo test -p sisonke-escrow` (result in §8). The tests were not taken as proof of anything; each
   invariant verdict below rests on the code path cited.

Severity uses impact × likelihood. **Critical/High** means funds can be stolen or frozen by an
unprivileged party. **Medium** means loss through a privileged or realistic operational path.
**Low** means limited impact, misconfiguration, or misleading guarantees. **Informational** covers
hardening, documentation, gas and style.

## 3. Summary of findings

| ID | Title | Severity | Status |
|---|---|---|---|
| SIS-01 | Upgrade authority is total and un-timelocked, and the default deployment gives it to a CLI hot key | Medium | Open (documented trust assumption) |
| SIS-02 | "Neither party can take the funds alone" is only true if the payer-chosen arbiter is independent | Low | Open |
| SIS-03 | `deploy.sh` off Testnet skips token verification and defaults to the Testnet USDC issuer | Low | Open |
| SIS-04 | Re-running `deploy.sh` silently replaces the live contract id in the env file and alias | Low | Open |
| SIS-05 | `upgrade.sh` doesn't validate the wasm it installs (fixture, missing `upgrade`, no hash check) | Low | Open |
| SIS-06 | Rollback silently drops fields added without a `STORAGE_VERSION` bump; the frozen-name list is incomplete | Low | Open |
| SIS-07 | `title` is arbitrary bytes, not validated UTF-8 as the docs say | Low | Open |
| SIS-08 | Anyone can create unsolicited escrows that name any address as recipient or arbiter | Informational | Open |
| SIS-09 | Payouts depend on the issuer and trustlines, including a freeze of the contract's own balance | Informational | Open |
| SIS-10 | CONTRACT.md misstates error precedence ("wrong signer always fails at `require_auth` first") | Informational | Open |
| SIS-11 | "Release" and "refund" are ambiguous: who can produce `Released` and `Refunded` | Informational | Open |
| SIS-12 | The dispute window closes at the deadline; last-minute disputes lose to `reclaim` | Informational | Open |
| SIS-13 | TTL and archival: index pages and idle instances archive; reads of archived entries need a restore | Informational | Open |
| SIS-14 | A pending migration blocks every exit, which the "pause never blocks exits" property doesn't cover | Informational | Open |
| SIS-15 | Admin-model details: pause survives `lock_upgrades`, proposals never expire, event gaps | Informational | Open |
| SIS-16 | Script hygiene: unchecked outputs, deploy ledger after deploy, builds from an uncommitted tree | Informational | Open |

Nothing found allows an unprivileged party to steal, redirect or freeze escrowed funds. Authorization,
state transitions, accounting and finality match the specification. The remaining risk is concentrated
in the admin/upgrade trust model and in operational tooling.

## 4. Findings

### SIS-01: Upgrade authority is total and un-timelocked, and the default deployment gives it to a CLI hot key

**Severity:** Medium · **Location:** `contracts/sisonke-escrow/src/lib.rs:508-518` (`upgrade`), `scripts/deploy.sh:52-53` (`ADMIN="${ADMIN:-$SOURCE_ADDRESS}"`), `scripts/deploy.sh:46-47` (`stellar keys generate`)

**Description.** `upgrade` installs any uploaded wasm right away, after one `Admin.require_auth()`.
New code can do anything with every locked token: it can transfer the contract's whole SAC balance,
rewrite escrows, or remove `upgrade`. There's no delay between the `upgraded` event and the new code
taking effect, so users can't exit first, and no second approver is required. `deploy.sh` defaults the
admin to the deployer identity, a key the `stellar` CLI generates and stores unencrypted on the operator's
machine. PLAN §7.4 / CONTRACT.md "Security model" document this honestly as trust assumption 1. The rating
reflects the total impact and the fact that the default configuration is the weakest one.

**Impact.** Whoever compromises the admin key (or a malicious admin) can drain every Funded and Disputed
escrow in one transaction pair: upload, then `upgrade`, then call the new code.

**Exploit scenario.** Malware on the deployer's laptop reads `~/.config/stellar/identity/sisonke-deployer.toml`,
uploads a wasm whose `sweep()` transfers `token.balance(contract)` to the attacker, calls `upgrade`, then
`sweep`. The `upgraded` event appears in the same ledger as the theft.

**Recommendation.**
- Make `ADMIN` mandatory in `deploy.sh` for any network other than Testnet, and refuse `ADMIN == SOURCE`
  unless `ALLOW_HOT_ADMIN=1`.
- Use a multisig admin: a Stellar account with weighted signers and thresholds, or a contract account.
- Ship the deferred upgrade timelock before mainnet: `propose_upgrade(hash)` emits an event, and
  `upgrade` is allowed only after `now >= proposed_at + DELAY`. Users then have a window to settle or
  reclaim.
- Keep the plan to call `lock_upgrades` once the code is final.

### SIS-02: "Neither party can take the funds alone" is only true if the payer-chosen arbiter is independent

**Severity:** Low · **Location:** `docs/CONTRACT.md:28-30` (rule 5), `contracts/sisonke-escrow/src/lib.rs:18-20` (crate docs), `lib.rs:596-603` (arbiter checks), `lib.rs:239-309` (`dispute`, `resolve`)

**Description.** The only checks on the arbiter are `arbiter ∉ {payer, recipient, this contract}`
(`lib.rs:596-603`). The payer alone picks it, and the recipient never signs anything, so they never accept
the escrow or its arbiter. A payer can name an address it controls, a sybil. Then before the deadline the
payer can `dispute(id, payer)`, and the sybil can `resolve(id, 0)`, which sends everything back to the
payer. Rule 5 states "Neither party can take the funds for themselves alone. The payer can only get funds
back unilaterally after the deadline", and the crate docs repeat it as a guarantee. Trust assumption 3 does
say a recipient should vet the arbiter, but the headline rule reads as unconditional.

**Impact.** A recipient who relies on rule 5 can deliver the work and still lose payment before the
deadline. The code works as designed; the documented guarantee is overstated.

**Exploit scenario.** The payer funds 1,000 USDC with `arbiter = G…ALT` (the payer's own second account)
and a 30-day deadline. The recipient delivers on day 10. The payer calls `dispute`, and `G…ALT` calls
`resolve(id, 0)`. The status is `Refunded`, and the recipient has no recourse on-chain.

**Recommendation.** Reword rule 5 (and `lib.rs:18-20`): "…alone, **unless the arbiter acts for them;
the payer chooses the arbiter, so a recipient must trust it before starting work.**" The web app should
show the arbiter prominently, with its history (via `party_escrow_count(arbiter, Arbiter)`), and warn on
unknown arbiters. The deferred "recipient accepts escrow" step (PLAN §10.6) is the structural fix.

### SIS-03: `deploy.sh` off Testnet skips token verification and defaults to the Testnet USDC issuer

**Severity:** Low · **Location:** `scripts/deploy.sh:22-23`, `scripts/deploy.sh:61-67`, `contracts/sisonke-escrow/src/lib.rs:75-86`

**Description.** The `EXPECTED_USDC_SAC` check runs only when `NETWORK == testnet`. On any other network,
`USDC_ISSUER` still defaults to Circle's **Testnet** issuer `GBBD47…`. `stellar contract id asset` derives
a SAC id for `USDC:GBBD47…` on that network, and if `decimals` doesn't answer, the script **deploys** that
SAC itself (line 66). The constructor only checks that `token` answers `decimals()`, and the token is
immutable (D1). So the escrow is permanently pinned to an asset that isn't Circle USDC on that network.

**Impact.** A permanent, wrong token pin. No funds are lost directly, since nobody holds that asset, but
the instance is unusable and has to be redeployed. A web app that trusts `deployments/<net>.env` would
point users at it.

**Recommendation.** Keep an explicit table of expected `(issuer, SAC)` per network (Testnet and
Mainnet Circle USDC). Refuse to continue on an unknown network unless both `USDC_ISSUER` and
`EXPECTED_USDC_SAC` are set explicitly. Never auto-deploy a SAC outside Testnet/local, and check
`token()` and `decimals() == 7` after deploy.

### SIS-04: Re-running `deploy.sh` silently replaces the live contract id in the env file and alias

**Severity:** Low · **Location:** `scripts/deploy.sh:81-88`, `scripts/deploy.sh:124-138`

**Description.** Each run deploys a **new** instance under the same `--alias` and overwrites
`deployments/testnet.env` (contract id, wasm hash, deploy ledger) without checking whether an instance
is already recorded there or whether it holds funds (`total_locked() > 0`).

**Impact.** Running `make deploy` a second time by mistake makes the web app, the bindings and
`upgrade.sh` (default `CONTRACT_ID`) switch to an empty contract. The escrows and USDC in the old instance
are safe but disappear from the UI, and later upgrades would target the wrong instance.

**Recommendation.** If `ENV_FILE` already exists and names a contract that answers `version()`, refuse
unless `FORCE_REDEPLOY=1`, and print the old instance's `total_locked`. Keep a dated copy of the previous
env file.

### SIS-05: `upgrade.sh` doesn't validate the wasm it installs

**Severity:** Low · **Location:** `scripts/upgrade.sh:53-68`, `scripts/upgrade.sh:72-83`, `contracts/upgrade-fixture/src/lib.rs:160-178`

**Description.** `upgrade.sh` uploads and installs any `WASM` it's given. With no argument it targets the
**production** contract id from `deployments/testnet.env`. It doesn't check that:
- the wasm isn't the test-only fixture (`testdata/upgrade_fixture.wasm`, "never deploy");
- the wasm still exports `upgrade`, `lock_upgrades`, `migrate`, `version`, `storage_version` and the
  escrow functions (UPGRADES.md "Layout rules" requires all of these);
- `version()` went up (unless a rollback is intended);
- `stellar contract fetch` of the live contract hashes to `$HASH` afterwards (it only prints the command).

The fixture has no escrow functions. Its `migrate` is **permissionless** and moves `StorageVersion` from
1 to 2. After that, a rollback to v1 refuses every write with 141 (`lib.rs:553-558`), and recovery needs a
newly built "v1 with `STORAGE_VERSION = 2`".

**Impact.** One mistyped command, `WASM=…/upgrade_fixture.wasm scripts/upgrade.sh` without the demo id,
freezes every exit on the main instance. Any third party can then make it worse by calling `migrate`.
Recovery needs a new build and another admin upgrade. Funds aren't lost while upgrades stay unlocked.
Installing a wasm without `upgrade` would make the freeze permanent.

**Recommendation.** Refuse the fixture's hash unless the target is the demo alias. Run
`stellar contract info interface --wasm "$WASM"` and require the functions listed above. Require
`VERSION_AFTER > VERSION_BEFORE` unless `ROLLBACK=1`. Show the network, contract id, current hash and new
hash, and ask for confirmation (or require `YES=1`). After the upgrade, fetch the live wasm and compare
its hash. Have `make` check `MIGRATE=1` against the fixture.

### SIS-06: Rollback silently drops fields added without a `STORAGE_VERSION` bump; the frozen-name list is incomplete

**Severity:** Low · **Location:** `docs/UPGRADES.md` "Versions" and "Layout rules", `contracts/sisonke-escrow/src/types.rs:51-90`, `contracts/sisonke-escrow/src/storage.rs:172-174`, `contracts/upgrade-fixture/src/lib.rs:32-42`

**Description.** UPGRADES.md says `STORAGE_VERSION` bumps "only when the storage layout changes", and
that new `Escrow` fields must be `Option<T>` "so records written by older code still load". So the rules
allow a v2 that adds `Option` fields **without** bumping `STORAGE_VERSION`. Per §2, v1's decoder
**ignores** unknown map keys. If such a v2 writes an escrow with the new field and is later rolled back to
v1 ("works cleanly before the new version's migrate", UPGRADES.md:52-56), the next v1 write
(`close`/`save`) re-encodes the record **without** the field. The data is lost with no error. Separately:
- `PartyRole` variant names are part of the `PartyCount`/`PartyPage` keys, but they're missing from the
  "never rename" list (only `DataKey`, `Status` and `Escrow` fields are named). Field **types** are part of
  the encoding too, not just names.
- The fixture copies only 6 of 11 `DataKey` variants and never decodes `PartyCount`, `PartyPage`, `Token`,
  `Paused` or `PendingAdmin`, so the "layout drift is caught by tests" claim is partial.

**Impact.** No impact on v1 by itself. The latent risk is silent data loss in a documented rollback flow.
Renaming `PartyRole` would orphan every index.

**Recommendation.** Define any new key, field, variant or type change as a layout change that bumps
`STORAGE_VERSION`. The existing guard (I18) then makes old code refuse to write, and the gap closes.
Add `PartyRole` variant names and all field types to the frozen list. Extend the fixture to declare and
read every `DataKey` variant.

### SIS-07: `title` is arbitrary bytes, not validated UTF-8 as the docs say

**Severity:** Low · **Location:** `contracts/sisonke-escrow/src/lib.rs:610-612`, `docs/CONTRACT.md:129-130`, `docs/PLAN.md` §2.1 (`MAX_TITLE_LEN` "bytes (UTF-8)")

**Description.** `title.len() <= 64` limits bytes only. Soroban `String` isn't UTF-8 validated by the host
or the SDK (§2). The title can hold invalid UTF-8, NUL and control characters, Unicode bidi overrides
(U+202E), zero-width characters, or HTML/markdown. It's stored and emitted in `created` exactly as given.
CONTRACT.md tells integrators the title is "at most 64 bytes of UTF-8".

**Impact.** An integrator who trusts the docs may decode strictly (and crash on invalid UTF-8), or render
the text unescaped. Combined with SIS-08, an attacker can push escrows titled, say, `Refund from Acme ‮kcilc‮`
or with HTML into a victim's dashboard. There's no on-chain fund impact.

**Recommendation.** Change the docs to "at most 64 bytes, not validated". In the web app, decode with
replacement, strip control and bidi characters, and always escape. Optionally reject bytes < 0x20 and
invalid UTF-8 on-chain (cheap for 64 bytes).

### SIS-08: Anyone can create unsolicited escrows that name any address as recipient or arbiter

**Severity:** Informational · **Location:** `contracts/sisonke-escrow/src/lib.rs:97-118`, `lib.rs:639-646`, `contracts/sisonke-escrow/src/storage.rs:204-213`

**Description.** `create` needs only the payer's signature and `amount > 0`. No tokens move until `fund`.
So anyone can cheaply add entries to any address's `Recipient` or `Arbiter` index. The paged index keeps
writes O(1), so other parties are never affected (D8 holds), but the victim's listing fills with junk.

**Impact.** UX denial of service and a phishing surface in the dashboard (see SIS-07). No fund risk.

**Recommendation.** By default the web app should hide `Created` escrows for recipients and arbiters, or
label them "unsolicited", and sort or filter by `Funded`. The deferred accept step addresses this
properly.

### SIS-09: Payouts depend on the issuer and trustlines, including a freeze of the contract's own balance

**Severity:** Informational · **Location:** `contracts/sisonke-escrow/src/lib.rs:293-306` (`resolve` two transfers), `lib.rs:698-704` (`pay_out`), `docs/CONTRACT.md:267-268`

**Description.** Trust assumption 4 covers a frozen or trustline-less **recipient**. It leaves out:
- `resolve` with a split needs **both** transfers to succeed, so either party can make a split
  impossible by having no trustline. The arbiter can then only choose 0 % or 100 %.
- A payer with no trustline or a frozen trustline blocks `refund`, `reclaim`, and any `resolve` that pays
  the payer.
- The issuer can freeze, or claw back (if the asset flags allow it), the **escrow contract's own** SAC
  balance. A freeze blocks every exit. A clawback breaks I1's `balance >= total_locked`, and the last
  escrows to settle would revert.

**Recommendation.** Extend trust assumption 4 with these cases. The UI should check trustlines before
offering `release`, `refund` or a split.

### SIS-10: CONTRACT.md misstates error precedence

**Severity:** Informational · **Location:** `docs/CONTRACT.md:40-42`, `docs/PLAN.md` §4 ("A wrong signer always fails at `require_auth` … before any contract error"), `docs/CONTRACT.md:117`, PLAN §8 I4

**Description.** Code order for escrow writes is 141, then 100, then `require_auth`
(`lib.rs:125-128` and peers), so a wrong signer on an unknown id gets 100, and during a pending migration
every caller gets 141. Other cases:
- `accept_admin` returns 201 before auth (`lib.rs:489-490`).
- `lock_upgrades` returns 141 before auth (`lib.rs:525-526`).
- On a terminal escrow, `dispute` with a non-party `by` returns 105, not 101 (`lib.rs:244-249`), and
  `resolve` with no arbiter returns 104.

I4 ("every escrow write returns 101") therefore holds only for the status error, though in every case
nothing changes. The `create_and_fund` error list ("as `create`, then 107") leaves out 143 (`TotalLocked`)
and SAC errors 1–13.

**Recommendation.** Say: "after the storage-version (141) and existence (100) checks, a wrong signer fails
at `require_auth`". List the other exceptions, and qualify I4 as "returns an error (101 for a party
signer) and changes nothing".

### SIS-11: "Release" and "refund" are ambiguous

**Severity:** Informational · **Location:** `docs/CONTRACT.md:20-30` (rules 1, 2, 5), `docs/CONTRACT.md:88-89` (state diagram)

**Description.** Rule 1 says "Only the **payer** can … release", but rule 5 says "only the payer **or
the arbiter** can release", and `resolve(id, amount)` produces status `Released` with no `released`
event. Likewise `refund` is a **recipient-only** function, while a payer getting money back calls
`reclaim`. The status `Refunded` comes from three signers: recipient `refund`, payer `reclaim` and arbiter
`resolve(id, 0)`. A front end that wires a payer's "Refund" button to `refund` gets an auth abort.

**Recommendation.** Add a glossary: **functions** (`release`: payer; `refund`: recipient; `reclaim`:
payer after the deadline; `resolve`: arbiter) versus **statuses** (`Released`: all to recipient;
`Refunded`: all to payer, whoever closed it). Fix rule 1 to "Only the payer can call `release`; the
arbiter can also send everything to the recipient through `resolve`."

### SIS-12: The dispute window closes at the deadline; last-minute disputes lose to `reclaim`

**Severity:** Informational · **Location:** `contracts/sisonke-escrow/src/lib.rs:253-256`, `lib.rs:224-226`

**Description.** The partition is exact (I10 holds). But a `dispute` submitted shortly before the deadline
can land in a ledger whose close time is already `>= deadline`. It fails with 102, and the payer's
`reclaim` then succeeds. This is inherent to D3 and isn't a bug, but recipients aren't warned.

**Recommendation.** The UI should stop offering "dispute" well before the deadline (for example, deadline
minus 10 minutes) and explain why. Document this next to rule 7.

### SIS-13: TTL and archival: index pages and idle instances archive; reads of archived entries need a restore

**Severity:** Informational · **Location:** `contracts/sisonke-escrow/src/storage.rs:16-45`, `storage.rs:204-226`, `docs/CONTRACT.md:248-252`

**Description.** The policy is correct: extend to 120 days when ≤ 60 days remain, and the host clamps to
the network maximum, so it never fails. Funds can't be lost to archival: since Protocol 23 an
`InvokeHostFunction` restores archived footprint entries. Some operational points aren't documented:
- Full `PartyPage`s are never written again, so they archive about 120 days after they fill. The keeper
  guidance covers escrows but not index pages.
- The instance and code archive after about 120 days with no writes, because reads don't extend them.
- Read calls are simulations, and they can't return data from archived entries without a restoring
  transaction, so the dashboard degrades.
- I19 assumes the network `max_entry_ttl >= TTL_THRESHOLD`.

**Recommendation.** Extend the keeper guidance to `extend_index_ttl` for every page of active parties and
to a periodic instance bump (any `extend_*` call does it). Document the read-after-archival behaviour for
the web app.

### SIS-14: A pending migration blocks every exit, which the "pause never blocks exits" property doesn't cover

**Severity:** Informational · **Location:** `contracts/sisonke-escrow/src/lib.rs:553-558` and every escrow write, `docs/UPGRADES.md:24-29`, `UPGRADES.md:58-74`

**Description.** While `StorageVersion != STORAGE_VERSION`, `release`, `refund`, `reclaim`, `resolve`
and `dispute` all return 141. This is intentional (I18) and limited by a permissionless `migrate`. But a
v2 with a buggy or multi-call migration, or a v3 installed directly on v1 data ("no skipping versions"),
freezes every exit until the admin ships a fix. CONTRACT.md's "pause never blocks a way out" is true, but
users may read it as "the admin can never block exits", and the storage guard is a second, admin-triggered
way to block them.

**Recommendation.** State this in the Security model. Require each version's `migrate` to handle every
older version it can meet, or have `upgrade.sh` refuse a target whose `STORAGE_VERSION` isn't
`stored + 1` or the same.

### SIS-15: Admin-model details

**Severity:** Informational · **Location:** `contracts/sisonke-escrow/src/lib.rs:454-496`, `contracts/sisonke-escrow/src/events.rs:114-125`

- `set_paused` keeps working after `lock_upgrades`, and there's no way to renounce the admin. A locked
  contract's admin can still block **new** escrows forever. This is a liveness risk only, but worth stating.
- A `PendingAdmin` never expires. A forgotten proposal can be accepted years later.
- `admin_proposal_cancelled` doesn't name the cancelled address, and a replacing `propose_admin` doesn't
  name the replaced one, so an indexer has to track state.
- `propose_admin(current_contract_address())` is accepted but can never be accepted (§2,
  self-authorization is impossible). It's harmless thanks to the two steps.
- The admin can also be an escrow's arbiter or recipient. Rule 6 ("admin can't perform any escrow
  action") is about the role, not the address.

**Recommendation.** Document these points. Consider adding the address to the cancel event, and an
optional proposal expiry in v2.

### SIS-16: Script hygiene

**Severity:** Informational · **Location:** `scripts/deploy.sh:106-109`, `deploy.sh:76`, `deploy.sh:82-88`, `scripts/upgrade.sh:61`, `scripts/upgrade-demo.sh:47-48`

- `DEPLOY_LEDGER` comes from a `sed` parse of `stellar ledger latest` and isn't checked: it may be empty.
  It's also read **after** the deploy, so the constructor's `init` event lies before the recorded start
  ledger. Use the deploy transaction's ledger, or subtract a margin.
- `WASM_HASH`, `CONTRACT_ID` and `HASH` aren't format-checked (64 hex characters; a 56-character `C…`
  strkey).
- `deploy.sh` and `upgrade.sh` build from the working tree, and the repository has no commits. The
  "reproducible build of the tagged source" in UPGRADES.md step 4 isn't possible yet. Record
  `git describe --dirty` in the env file, and refuse a dirty tree for production.
- `upgrade-demo.sh:48` compares `$BALANCE` numerically. A non-numeric CLI output aborts the script, which
  is safe but unclear.
- Gas/style: the `by` fields of `released`/`refunded` are always the payer/recipient, which is redundant
  with the payload. `set_paused` emits an event even when nothing changes. `Escrow.token` repeats a
  constant in every record (about 40 bytes, kept on purpose for forward compatibility).

## 5. Invariants (PLAN.md §8)

| # | Invariant | Verdict | Evidence |
|---|---|---|---|
| I1 | Conservation: `total_locked == Σ Funded+Disputed`, `balance >= total_locked` | **Holds** (except issuer clawback, SIS-09) | `+amount` only in `mark_funded` (`lib.rs:650-656`), used by `fund` and `create_and_fund`. `-amount` only in `close` when status ≠ `Created` (`lib.rs:683-685`), and `close` is reached only from Funded/Disputed or (cancel) Created. Checked arithmetic (`storage.rs:146-160`). The inflow balance delta must equal `amount` (`lib.rs:660-670`). Outflows per escrow sum to `amount` (I2). Donations only add to the balance. |
| I2 | Exact payout and status meaning | **Holds** | release `(amount, 0)`, refund/reclaim `(0, amount)`, cancel `(0, 0)` (`lib.rs:187, 205, 228, 324`). resolve: `0 <= r <= amount`, `p = amount - r`; `Released` iff `p == 0`, `Refunded` iff `r == 0`, else `Split` with both > 0 (`lib.rs:282-292`). The transfers match the recorded fields (`lib.rs:301-306`). |
| I3 | Destinations: only the escrow's payer or recipient | **Holds** | Every outflow goes through `pay_out(…, &escrow.recipient / &escrow.payer, …)` (`lib.rs:188, 206, 229, 302, 305`). `escrow.token` comes only from the pinned token (`lib.rs:619`). No function takes a destination. Recipient ≠ contract (`lib.rs:596`). |
| I4 | Finality: writes on terminal escrows fail, change nothing | **Holds in substance** | Status checks in every write (`lib.rs:130, 185, 203, 221, 247, 279, 320`), and an error rolls back (§2). The error code is 101 for a party signer, but 105/104/auth abort come first in some cases (SIS-10). |
| I5 | Single execution: ≤ 1 funded event, ≤ 1 closing event, outflow ≤ amount | **Holds** | `fund` requires `Created`. Every closing function requires a non-terminal status and moves to a terminal one before transferring. There's no re-entry (the host forbids it, and the SAC makes no callbacks). |
| I6 | Transition closure, no backward moves | **Holds** | The only writes to `status` are `lib.rs:257` (Funded→Disputed), `652` (Created→Funded) and `686` (`close`: to terminal from Created/Funded/Disputed as gated). These match the §4 edges exactly. |
| I7 | Authorization per §4 | **Holds** | Signers are read from stored data: payer (`lib.rs:128, 184, 220, 319`), recipient (`202`), arbiter (`277-278`); `by` is checked against the stored parties (`243-246`). `create*` signer is the `payer` argument, whose auth covers all arguments. Auth happens before any write in every function. |
| I8 | Admin can't move funds | **Holds literally / Partially in substance** | `set_paused`, `propose_admin`, `cancel_admin_proposal`, `accept_admin`, `lock_upgrades` touch only instance admin keys and flags (`lib.rs:454-533`). `upgrade` changes no record or balance itself but can install code that does (SIS-01). |
| I9 | Immutable terms | **Holds** (v1 code) | After `new_escrow` (`lib.rs:614-635`), the only writes are to status, `funded_at`, `disputed_*`, `closed_*`, `paid_*` and `updated_ledger` (`lib.rs:257-260, 650-656, 686-691`). |
| I10 | Deadline partition | **Holds** | fund/dispute need `now < deadline` (`lib.rs:133, 254`); reclaim needs `now >= deadline` (`lib.rs:224`). Same `ledger().timestamp()` source. |
| I11 | Dispute gating | **Holds** | `Disputed` is set only in `dispute`, after `arbiter.is_some()` and `now < deadline` (`lib.rs:250-256`). `reclaim` requires exactly `Funded` (`lib.rs:221`). `resolve` requires `Disputed` and the stored arbiter's auth (`lib.rs:277-281`). |
| I12 | IDs unique, sequential from 1, `escrow_count == NextId-1` | **Holds** | `NextId = 1` in the constructor. `take_next_id` uses a checked increment (`storage.rs:129-133`), only after validation. Failed transactions roll back the increment. `escrow_count` (`lib.rs:378-380`). |
| I13 | Index: once per role, creation order, ≤ PAGE_SIZE, count = total | **Holds** | `index_push` appends to page `count / 50` and then increments the count (`storage.rs:204-213`). It's called once per role per create (`lib.rs:639-646`). payer ≠ recipient ≠ arbiter, so there are no duplicates within one role. |
| I14 | Atomicity | **Holds** (host guarantee) | Contract `Err` returns and traps roll back the frame's storage and events (`env-host frame.rs:518-545, 607-612`), and a top-level failure discards everything. |
| I15 | Pause scope: only create / create_and_fund / fund | **Holds** | `ensure_not_paused` is called only at `lib.rs:110, 129, 160`. But see SIS-14 for a non-pause way the admin can block exits. |
| I16 | Upgrade preservation; lock blocks later upgrades across handover | **Holds** | `update_current_contract(Wasm)` swaps only the executable (§2). `UpgradesLocked` is set only to `true` (`lib.rs:530`) and is checked in `upgrade` (`lib.rs:511`) whoever the admin is. Only the contract can change its own executable, so once locked, no code that skips the check can be installed. |
| I17 | Event completeness | **Holds** | `created` carries every term (`events.rs:169-182`). Every transition emits an event with the data to rebuild status and paid amounts (`released`/`refunded`/`reclaimed` carry `amount`; `resolved` carries both sides and the status). `closed_by` and `disputed_by` can be derived. RPC retention is a separate limit. |
| I18 | Storage guard | **Holds** | `ensure_storage_current` is the 2nd statement of all 9 escrow writes and of `lock_upgrades` (`lib.rs:108, 126, 158, 182, 200, 218, 241, 274, 317, 525`). |
| I19 | TTL ≥ threshold after writes | **Holds** (assumes network max TTL ≥ 60 d) | `extend_instance` is the first statement of every public write. Every persistent `set` goes through `set_persistent`, which extends (`storage.rs:32-39`). The host extends when `ttl <= threshold` and clamps instead of failing (§2). |

## 6. Spec conformance notes (PLAN.md §3/§4)

- **§3.0 order** is followed by every escrow write: extend, then 141, then 100, then auth, then pause,
  then status, then time, then arguments, then effects, then transfer, then event. `resolve` checks 104
  before auth as specified. `dispute` checks 105 before 101 as specified. The recorded deviations 1–3
  (PLAN "Deviations") match the code.
- **CEI.** State is saved before every transfer (`close` saves at `lib.rs:692`; `fund` saves at
  `lib.rs:137` before `pull_funds`). Soroban forbids re-entry, and failures are atomic.
- **Arithmetic.** All counters and `TotalLocked` use checked arithmetic. `amount - recipient_amount`
  can't underflow because of the range check. `now.saturating_add(MAX_DURATION)`. Release profile
  `overflow-checks = true`.
- **Events** match the §6 table exactly (topics `("sisonke", action, id)`; vec data for the three empty
  events). `create_and_fund` emits `created` then `funded`.
- **Reads** don't authenticate, write or extend.
- **Budget.** `get_escrows` is capped at 20 entries. A page holds ≤ 50 `u64`s. `create_and_fund` with an
  arbiter writes about 10 entries (escrow, 3 pages, 3 counts, instance, 2 SAC balances), well within the
  per-transaction limits.

## 7. Trust assumptions

1. **Admin (until `lock_upgrades`)** has total control over all locked funds through `upgrade` (SIS-01).
   It has no delay and no co-signer by default. After the lock, the admin keeps only pause (inflows) and
   handover (SIS-15).
2. **Payer-chosen arbiter** is trusted by the recipient for fairness from creation on, and by both parties
   for liveness once a dispute opens. It may secretly be the payer (SIS-02). There's no dispute timeout:
   if it never acts, funds stay locked until one side concedes.
3. **Deployer configuration.** The constructor accepts any contract that answers `decimals()` as the
   token, and the choice is permanent. Users and the web app must check `token()` against the expected
   USDC SAC for the network (SIS-03).
4. **USDC issuer (Circle)** can freeze individual parties or the contract itself, and claw back if the
   asset allows it (SIS-09).
5. **Future versions** must keep honouring `UpgradesLocked`, the storage guard and the layout rules.
   Nothing on-chain enforces this before the lock (SIS-05, SIS-06).
6. **Soroban host and the SAC** behave as checked in §2: no re-entry, rollback on error, auto-restore of
   archived entries (Protocol ≥ 23), and `sparse_map_unpack_to_slice` (Protocol ≥ 28).
7. **Off-chain infrastructure.** RPC keeps events for about 7 days, and someone must keep TTLs up for
   long-lived escrows and index pages (SIS-13).

## 8. Test run

`cargo test -p sisonke-escrow` (non-ignored tests; the `#[ignore]`d compiled-wasm tests need the
`stellar` CLI): **138 passed, 0 failed, 5 ignored**. The run used a separate target directory, on the
tree whose hashes are in §1. A passing suite is consistent with the verdicts above, but none of them
depends on it.

## 9. Remediation

Applied by the Coding agent after the audit (2026-10-29). Verification: `cargo fmt --check` and
`cargo clippy --all-targets -- -D warnings` clean; `make test` (wasm build plus every test, including
the `#[ignore]`d compiled-wasm tests and the adversary suite): **157 passed, 0 failed** (after the timelock / multisig / index round; 146 before it);
`bash -n` on every script; `npm run typecheck` in `scripts/`. Nothing has been deployed yet, so
the script changes are not yet exercised on a network.

| ID | Status | What changed, and where |
|---|---|---|
| SIS-01 | **Fixed** (timelock + multisig; `lock_upgrades` still recommended before mainnet) | Upgrades are now two-step with a public delay: `propose_upgrade(hash)` stores `PendingUpgrade { wasm_hash, proposed_at, eta }` and emits `upgrade_proposed`; `upgrade()` (no argument) runs it only at `now >= eta` (204 `UpgradeTooEarly`, 203 `NoPendingUpgrade`), clearing it before the code swap. The delay is a constructor argument bounded to 60 s ..= 30 days (202), and `set_upgrade_delay` only raises it (205). `deploy.sh` uses 1 h on Testnet and requires ≥ 2 days on mainnet. `cancel_upgrade`, `lock_upgrades` and `accept_admin` clear a pending proposal, so a handover never shortens the wait. During the delay every exit works (`timelock::every_exit_works_while_an_upgrade_is_pending`, `wasm::compiled_v1_timelocked_upgrade_to_fixture`, model test). The admin is now a native multisig account (`scripts/multisig-admin.sh`: 2-of-3, master weight 0), the default on Testnet; off Testnet `deploy.sh` requires an explicit admin ≠ deployer. Admin calls are signed by M signers via `scripts/admin.ts`; the host's multisig check is documented in UPGRADES.md "Multisig admin". |
| SIS-02 | **Fixed (docs)** | CONTRACT.md rule 5 now says it holds only if the arbiter is independent of the payer, and trust assumption 3 notes the sybil arbiter; `lib.rs` crate docs reworded. The recipient-accept step stays deferred (PLAN §10.6). |
| SIS-03 | **Fixed** | `deploy.sh` has a per-network table (Testnet and Mainnet Circle USDC issuer + SAC id) and refuses any other network. It requires the derived SAC id to match, never runs `contract asset deploy` outside Testnet, and checks `decimals() == 7` and `token()` after deploy. |
| SIS-04 | **Fixed** | `deploy.sh` refuses to replace an existing `deployments/<network>.env` unless `FORCE=1`. It prints the old instance's `total_locked` and keeps a timestamped `.bak` copy. `upgrade-demo.sh` uses `FORCE=1` only for its own demo env file. |
| SIS-05 | **Fixed** | `upgrade.sh` refuses the upgrade fixture (by hash) unless `ALLOW_FIXTURE=1`, which only `upgrade-demo.sh` sets; the demo also refuses to target the main deployment. It requires the wasm to export `upgrade`, `lock_upgrades`, `migrate`, `version`, `storage_version`, the admin functions and the escrow functions (`stellar contract info interface --wasm`). It reads `sisonke_version` / `sisonke_storage_version` from new `contractmeta!` entries and requires the version to rise unless `ROLLBACK=1`, and the storage version to be stored or stored + 1. It asks for confirmation unless `YES=1`, then fetches the live code and compares its hash with the uploaded one. New tests `wasm_meta_matches_version_constants` and `fixture_meta_says_version_two` keep the metadata honest. |
| SIS-06 | **Fixed** | The rule is now: any new `DataKey`/`Status`/`PartyRole` variant, `Escrow` field or type change is a layout change that bumps `STORAGE_VERSION`, so the storage guard makes a rolled-back old version refuse writes instead of silently dropping fields. The full frozen list (including `PartyRole` names and every field type) is in the `types.rs` header and UPGRADES.md "Storage ABI: what is frozen". The fixture now declares all 11 `DataKey` variants and reads pending admin, token, pause flag and the party index; `admin_upgrade_preserves_address_storage_and_funds` decodes them. |
| SIS-07 | **Fixed** | `create` / `create_and_fund` now reject a title that is not valid UTF-8 or contains a byte `< 0x20` or `0x7F`, with new error **128 `InvalidTitle`** (appended; nothing renumbered), checked after the length cap (126). The check copies the title into a 64-byte stack buffer and uses `core::str::from_utf8` (`lib.rs` `validate_title`). Test: `validation::title_must_be_utf8_without_control_bytes`. CONTRACT.md says printable Unicode (bidi, zero-width, HTML) is still allowed and the UI must escape it. |
| SIS-08 | **Fixed** | `create` now indexes an escrow only for its payer; the recipient and arbiter get it when it is funded (`fund` / `create_and_fund`), so unfunded spam never reaches anyone else's list and a cancelled-before-funding escrow never does either. Funded spam costs the sender the full amount. Tests: `index::index_records_payer_recipient_and_arbiter`, `index::spam_escrows_do_not_touch_other_parties_index`, `adversary::stranger_can_spam_victims_index_but_not_its_funds` (updated for this behaviour), model test. Web-app duties (label `Created` as "Awaiting deposit — not funded", escape titles) are in INTEGRATION.md. |
| SIS-09 | **Acknowledged (documented)** | CONTRACT.md trust assumption 4 now covers payer-side trustlines and freezes, splits needing both transfers, and a freeze or clawback of the contract's own balance. |
| SIS-10 | **Fixed (docs)** | CONTRACT.md "Error precedence" says 141 and 100 come before auth and lists the other pre-auth errors (104, 201, 141 on `lock_upgrades`, 105). The `create_and_fund` error list adds 143 and the SAC error note. The I4 wording in CONTRACT.md now reads "refused (101 for a party signer) and change nothing". PLAN.md §8 is left as written (binding spec). |
| SIS-11 | **Fixed (docs)** | CONTRACT.md "Functions versus statuses": a function → signer → status table, and a complete "final status × function × signer × event × `closed_by`" table. |
| SIS-12 | **Acknowledged (documented)** | CONTRACT.md "Disputing near the deadline", next to rule 7: a late dispute can lose to `reclaim`; the UI should stop offering disputes about 10 minutes before the deadline. |
| SIS-13 | **Acknowledged (documented)** | CONTRACT.md "TTL" keeper guidance now covers index pages, a periodic instance bump, and reads of archived entries needing a restoring transaction. |
| SIS-14 | **Acknowledged (documented), mitigated in tooling** | CONTRACT.md Security model "A pending migration blocks exits" (anyone can end it by calling `migrate`), and UPGRADES.md "Versions". `upgrade.sh` refuses a storage version that skips ahead, and warns loudly when writes will be blocked. |
| SIS-15 | **Acknowledged (documented); event and expiry changes Deferred to v2** | CONTRACT.md "Admin writes" lists: pause survives `lock_upgrades`, the role can't be renounced, proposals never expire, the cancel event doesn't name the address, self-proposals are harmless, `paused` emits on no-op, and rule 6 is about the role, not the address. |
| SIS-16 | **Fixed (scripts); gas/style items Acknowledged** | `deploy.sh` reads the deploy ledger **before** deploying, records the deploy tx hash when the CLI prints one, and checks formats (wasm hash, contract and account ids, ledger number, uploaded hash == local file hash). It records `git describe --always --dirty` as `SISONKE_SOURCE_REV` and refuses an uncommitted tree off Testnet. `upgrade.sh` checks formats and versions; `upgrade-demo.sh` checks its balances are numeric. The redundant `by` fields, the no-op `paused` event and `Escrow.token` are kept unchanged (event/storage ABI, forward compatibility). |

## Round 2: timelock, multisig admin, funded-only index

| | |
|---|---|
| Target | Working tree on top of `67c8800` (`git diff HEAD` plus untracked `scripts/admin.ts`, `scripts/multisig-admin.sh`, `docs/INTEGRATION.md`, `src/test/timelock.rs`). `src/test/adversary_timelock.rs` (being written concurrently) is out of scope. |
| Changes | (A) upgrade timelock: constructor `upgrade_delay` (60 s ..= 30 days), `propose_upgrade` / `cancel_upgrade` / `upgrade()` at `now >= eta` / increase-only `set_upgrade_delay`; `lock_upgrades` and `accept_admin` clear the proposal. (B) native Stellar multisig admin (`multisig-admin.sh`, `admin.ts`, `deploy.sh`, `upgrade.sh`, `upgrade-demo.sh`). (C) recipient and arbiter index entries written only on funding. |
| Host semantics | Checked in `~/.cargo/registry/src/index.crates.io-*/soroban-env-host-29.0.1` and `soroban-sdk-29.0.1`; the JS signing path in `scripts/node_modules/@stellar/stellar-sdk` 17.2.1 (`lib/esm/base/auth.js`). |
| File hashes (SHA-256) | `lib.rs` `16dd6b26…`, `storage.rs` `8423874e…`, `types.rs` `5b58aa09…`, `errors.rs` `015d964c…`, `events.rs` `b214f2f4…`, `admin.ts` `4329a198…`, `multisig-admin.sh` `9fbebef4…`, `deploy.sh` `040a9fde…`, `upgrade.sh` `a9ccb811…`, `upgrade-demo.sh` `5264f208…` |
| Test run | `cargo test -p sisonke-escrow` (separate target dir): **150 passed, 0 failed, 7 ignored**. That's consistent with the "157" in §9, which includes the ignored compiled-wasm tests run by `make test`. |
| Result | **No Critical, High or Medium findings.** 6 Low, 3 Informational. The on-chain timelock has no bypass. The residual risk is in what the docs promise users during the delay, and in multisig tooling that doesn't yet deliver independent signers. |

### R2.1 Timelock review: what holds

- **No bypass.** `update_current_contract` is reached only from `upgrade()` (`lib.rs:610-626`). That path needs `Admin.require_auth()`, `!UpgradesLocked`, a stored `PendingUpgrade` and `ledger.timestamp() >= eta`. `propose_upgrade` sets `eta = now + delay` with `delay >= 60`, so propose and execute can't share a ledger. Re-proposing overwrites the single slot with a fresh `proposed_at`/`eta` (`lib.rs:578-586`), so a proposal can't be swapped for another hash without restarting the delay. `set_upgrade_delay` only raises the delay and never touches a pending `eta` (`lib.rs:631-644`), so it can't shorten one. `accept_admin` clears the old admin's proposal (`lib.rs:555`), so a handover gives no head start. `upgrade()` clears the proposal before the swap (`lib.rs:621`), so the new code never inherits a runnable proposal. The host refuses an unknown hash in `update_current_contract_wasm` (`soroban-env-host host.rs:2452-2461`, `verify_wasm_exists`). The whole transaction then reverts and the proposal survives, as CONTRACT.md says.
- **Arithmetic.** `now.checked_add(delay)` (`lib.rs:582-584`): `delay <= 2_592_000`, so the add can only overflow at a timestamp within 30 days of `u64::MAX`. The comparison `timestamp < eta` matches the documented boundary (refused at `eta - 1`, allowed at `eta`, tested).
- **Storage tier and TTL.** `UpgradeDelay` and `PendingUpgrade` are **instance** keys (`storage.rs:105-129`). They live inside the contract-instance ledger entry and can't be archived on their own. A missing key means the whole instance is missing. Every admin write first calls `extend_instance`, which extends instance **and code** (`soroban-sdk storage.rs:616-646`) to 120 days whenever fewer than 60 remain. A proposal therefore always has more than 60 days of TTL, which exceeds `MAX_UPGRADE_DELAY`, so it can't archive during its own delay. Failure mode if the instance does archive (about 60-120 idle days): reads (`pending_upgrade`, `info`) fail in simulation, while an `InvokeHostFunction` that restores the entry (Protocol 23 auto-restore) brings `PendingUpgrade` back with its old `eta`. That combines with SIS-18. `UpgradeDelay` is read with `unwrap()`. That's sound on an instance built by this constructor, and fatal on one that isn't (SIS-22).
- **Events.** `upgrade_proposed {new_wasm_hash, proposed_at, eta}`, `upgrade_cancelled {wasm_hash}` (cancel, lock, handover), `upgraded {new_wasm_hash, from_version}`, `upgrade_delay_changed`, and `init` carrying the delay together give a banner what it needs. The host also emits its own executable-update event (`host/lifecycle.rs:50-59`). The gaps (replacement, no expiry signal) are in SIS-24.
- **Exits during the delay.** None of the exit functions read upgrade state. Pause gates only `create`/`create_and_fund`/`fund`. `timelock::every_exit_works_while_an_upgrade_is_pending` exercises every exit. So the code delivers what it promises; the *promise as worded* is broader than the code (SIS-17). With a pending migration, exits are blocked for at least one full delay (SIS-19).

### R2.2 Multisig: host semantics verified

UPGRADES.md "What the Soroban host checks" is accurate, with one exception (SIS-25):

| Claim | Verified at (soroban-env-host 29.0.1) |
|---|---|
| Address credentials: signature is a `Vec<{public_key, signature}>`, 1..=20 entries | `builtin_contracts/account_contract.rs:25, 62-67, 181-199` |
| Strictly ascending by public key, so no duplicates | `account_contract.rs:205-216` (`compare != Less` → error) |
| Each signature ed25519-verified over the payload | `account_contract.rs:218-222` |
| A key with weight 0 (including a weight-0 master) fails the whole entry, even if others reach the threshold | `account_contract.rs:224-236`; master weight from `thresholds[MasterWeight]`, others from `signers` (clamped to 255): `host/data_helper.rs:513-558` |
| Sum of weights `>=` **MEDIUM** threshold | `account_contract.rs:245-262` |
| Account entry loaded from storage, so it must be in the footprint | `account_contract.rs:200`, `data_helper.rs:469-480` |
| Payload = sha256(XDR `HashIdPreimage`): network id, nonce, `signature_expiration_ledger`, invocation; `ADDRESS_V2`/`WITH_DELEGATES` add the address | `auth.rs:2631-2662` (`uses_preimage_with_address`, `auth.rs:592-594`) |
| Expiration enforced (`ledger_seq <= expiration <= max_live_until`), nonce consumed as a temporary entry, replay refused | `auth.rs:2586-2619`, `auth.rs:2958-3010` |
| Source-account credentials: the host performs no signature check | `auth.rs:2665-2672` (`if is_transaction_source_account() { return Ok(()) }`), and no nonce `auth.rs:2587-2589`. The threshold applied to the tx signatures is stellar-core's, which isn't in this crate (InvokeHostFunction uses the default MEDIUM operation threshold; not verifiable here). |
| Recording simulation emulates one signature, and records `AddressV2` when the RPC asks for it | `auth.rs:2725-2760`, `auth.rs:2431-2460`, `e2e_invoke.rs:622-650` (`use_address_v2`) |

`scripts/admin.ts` produces exactly what the host expects. `authorizeInvocation` (SDK `auth.js:136-164`) builds `ADDRESS` or `ADDRESS_V2` credentials with a random int64 nonce. Its preimage (`auth.js:165-201`) is `sha256(passphrase)` + nonce + `validUntilLedgerSeq` + invocation (+ address for V2), identical to `auth.rs:2631-2662`. `multisigSignature` (`admin.ts:176-189`) sorts by raw 32-byte key with `Buffer.compare`, the same byte order as the host's `BytesN` compare. Each map's keys are `public_key` < `signature`, which sorts correctly. The invocation has no sub-invocations, and the admin functions make no nested `require_auth`. Expiration is the latest ledger + 100. It doesn't dedupe signers: a duplicated identity fails on-chain as "not ordered", which is safe. The credential type comes from the network's own recording simulation (`admin.ts:161-173`).

`multisig-admin.sh`, from a fresh account, produces a correct M-of-N: weight-1 signers added under the master key, then one `set-options` (authorized at the pre-op thresholds) that sets master weight 0 and low/med/high to M (`multisig-admin.sh:116-118`). After that, changing signers, thresholds or merging (HIGH) needs M signers, so no single signer can take over. The re-run path is the weak spot (SIS-20).

`deploy.sh` enforces an explicit `ADMIN` off Testnet that isn't the deployer (`deploy.sh:118-121`), a mandatory `UPGRADE_DELAY >= 172800` off Testnet (`deploy.sh:129-137`), and reads `upgrade_delay` back after deploy (`deploy.sh:212`).

### R2.3 Funded-only index review

`create` pushes only `(payer, Payer)` (`lib.rs:157`). `fund` pushes recipient and arbiter (`lib.rs:180`, `index_counterparties` `lib.rs:795-801`). `create_and_fund` pushes all of them (`lib.rs:211-212`). `fund` requires `Status::Created` and moves the escrow to `Funded` in the same call, so no transition runs it twice. There are therefore **no duplicates**: payer ≠ recipient ≠ arbiter is enforced (`lib.rs:730-740`), each role is pushed at most once per escrow, and `create_and_fund` never meets `fund`. **Ordering:** a payer's pages are in id/creation order. Recipient and arbiter pages are in funding order, which is not id order, because `fund` can happen any time before the deadline. **Page boundaries** are unchanged (`storage.rs:230-239`: page `count / 50`, two writes). A failed transfer reverts the index writes with everything else. Unfunded and cancelled-before-funding escrows never reach a counterparty's list. Funded spam remains cheap (SIS-23).

### R2.4 Findings

| ID | Title | Severity | Status |
|---|---|---|---|
| SIS-17 | "Every escrow can still be exited" overstates the delay: a payer can't recover funds before the deadline without the recipient or the arbiter | Low | Open |
| SIS-18 | Matured proposals never expire: once `eta` passes, the upgrade can run at any later moment, with no fresh notice | Low | Open |
| SIS-19 | No emergency path: with a pending migration, every exit stays blocked for at least one full (increase-only) delay | Low | Open |
| SIS-20 | `multisig-admin.sh` re-run and `deploy.sh` off Testnet don't verify the full M-of-N configuration (high/low thresholds, signer weights, extra signers) | Low | Open |
| SIS-21 | Signing tooling puts all signer keys on one machine; there's no flow for independent signers | Low | Open |
| SIS-22 | The recorded Testnet deployment is still the instant-upgrade, single-key build, and the new code can't be installed on it in place | Low | Open |
| SIS-23 | SIS-08 residual: funded spam costs one stroop for one second, not "the full amount" | Informational | Open |
| SIS-24 | Event/ABI gaps for watchers: replacement has no cancel event, `upgrade()` doesn't bind the hash, the export check ignores signatures | Informational | Open |
| SIS-25 | Doc precision: error surfaced for a failed multisig check, "oldest first", mainnet delay is policy only | Informational | Open |

#### SIS-17: "Every escrow can still be exited" overstates the delay

**Severity:** Low · **Location:** `lib.rs:562-567` (doc comment), `docs/CONTRACT.md:21-24, 376-379`, `docs/UPGRADES.md:13-15, 48`, `docs/INTEGRATION.md:24-28`, `README.md:7-10`

**Description.** During the delay, each exit function works, but a **payer** can only get funds *back* via `reclaim` after the deadline, or with the recipient's `refund`, or with an arbiter's `resolve` on a disputed escrow. Before the deadline, the payer's only unilateral exit is `release`, which pays the recipient. A disputed escrow can't be reclaimed at all. `MAX_DURATION` is 365 days, while `MAX_UPGRADE_DELAY` is 30 days and the mainnet policy is 2 days, so most open escrows have deadlines beyond `eta`. The timelock test confirms this: it asserts `DEADLINE > eta`, and its payer exit is a release. What the delay does guarantee is weaker but real: **any one party can move the funds to a legitimate party (the other side) before `eta`**, so a malicious upgrade can only take escrows nobody acted on. The INTEGRATION banner text ("release, refund, reclaim or resolve your escrows before then") reads as if each user can rescue their own money.

**Recommendation.** Reword CONTRACT.md trust assumption #1, UPGRADES.md, the `lib.rs` docs and the banner text. Say that the delay lets either party send the funds to the counterparty, and that recovering them for yourself before the deadline needs the counterparty's `refund` / `release` or the arbiter. Tell the web app to prompt counterparties of open escrows to settle cooperatively when a proposal appears. Size the mainnet delay against typical response times, not just "2 days". If a real unilateral exit is wanted, it needs a design change (for example, a mutual-exit request that either party can trigger and the other can accept), not a timelock tweak.

#### SIS-18: Matured proposals never expire

**Severity:** Low · **Location:** `lib.rs:572-589`, `lib.rs:610-626`; `docs/INTEGRATION.md:24-28`

**Description.** A proposal stays executable indefinitely after `eta`, until it is run or cancelled. The admin can propose, let the banner run for weeks until users stop reacting, then execute without notice. Escrows created or funded **after** `eta` get no delay at all: `create`/`fund` are allowed with a matured proposal pending. Combined with instance archival (R2.1), a stale proposal may not even be readable through simulation while an auto-restoring `upgrade()` can still run it. SIS-15 already notes that admin proposals never expire; the same choice now affects code upgrades, where it matters more. Compound's Timelock uses a 14-day `GRACE_PERIOD` for this reason.

**Recommendation.** Add an execution window: `upgrade()` refuses after `eta + GRACE` (for example 7 days) with a new error, and the proposal must be re-made, which restarts the delay. Short of that, the banner must change after `eta` to "can take effect at any moment". The web app (or the contract) should warn on, or refuse, `create`/`fund` while a matured proposal is pending.

#### SIS-19: No emergency path while a migration is pending

**Severity:** Low · **Location:** `lib.rs:690-695` (`ensure_storage_current` on every exit), `lib.rs:610-619`, `lib.rs:631-644`; `docs/UPGRADES.md:55-57, 112-116`

**Description.** SIS-14 (exits blocked while `storage_version != STORAGE_VERSION`) used to be fixable at once by an upgrade. Now the fix must wait a full `upgrade_delay`: at least 2 days on mainnet, up to 30 days, and the delay can only rise. The trigger can be a migration that runs out of budget, a v3 installed onto layout 1, or a rollback after a migrate. In that state every `release`/`refund`/`reclaim`/`dispute`/`resolve` returns 141 for at least the delay. `migrate` is permissionless but can't help if it is the broken part. No funds are lost, but this is the one admin-triggered state in which nobody can exit, and the timelock lengthens it.

**Recommendation.** Document the worst case ("a broken migration freezes exits for at least `upgrade_delay()`") in CONTRACT.md's Security model, and make migration rehearsal on a copy of real data a release gate. Optionally, allow an immediate `upgrade()` only back to the wasm hash that was running before the last upgrade, and only while that upgrade's migration hasn't completed. That's narrow enough not to reopen SIS-01, since the old code has already been public for at least one delay. Think twice before raising the delay to 30 days.

#### SIS-20: The M-of-N configuration isn't fully verified on re-run or off Testnet

**Severity:** Low · **Location:** `scripts/multisig-admin.sh:97, 111-112, 122-124`; `scripts/deploy.sh:118-122`

**Description.** The "already configured" branch (`:111`) and the final checks (`:122-124`) verify only master weight 0 and `med_threshold == M`. They don't check `low_threshold` or `high_threshold`. A signer counts as present if its weight is `>= 1` (`:97`), so a weight-2 signer passes with M = 2, and signers that aren't `<NAME>-signer-i` (other keys, pre-auth tx, hash-x, signed-payload) are ignored. On mainnet the script requires a **pre-existing** account, which is exactly where an inherited configuration is likely. Example: an account with `high_threshold 1`, or one signer of weight 2, is reported as "2-of-3 with the master key disabled". Yet one key can then run `set_options` (HIGH) to add itself at weight 255 or reset thresholds, taking full admin control. Off Testnet, `deploy.sh` checks only that `ADMIN` is set and isn't the deployer. A single-key account (or one that later rotates to single control) is accepted.

**Recommendation.** One shared check, used by `multisig-admin.sh` (both branches) and by `deploy.sh` for any `ADMIN` G-address, that requires:
- master weight 0;
- low = med = high = M (or at least med and high `>= M`);
- the signer set exactly equal to the expected keys, each of weight 1, with no other signer types.

Print the account's signers in the deploy summary. Note in UPGRADES.md that the contract itself can't enforce this, and that `propose_admin` can hand the role to any address.

#### SIS-21: Signing tooling puts all signer keys on one machine

**Severity:** Low · **Location:** `scripts/multisig-admin.sh:62-75` (`identity … nofund` generates missing signer keys locally on any network), `scripts/admin.ts:94-102, 235-237`; `docs/UPGRADES.md:265-266`

**Description.** `admin.ts` needs the M signers' **secret keys in one process**, read from the local `stellar` keystore or passed as `S…` on the command line, where they land in shell history and `ps`. There's no way to collect signatures from signers on different devices. `multisig-admin.sh` silently creates any missing `<NAME>-signer-i` as a fresh local key, including on mainnet. So following the tooling yields N keys plus the master secret in plaintext under the operator's `stellar` config. That is exactly SIS-01's exploit scenario: malware reading the identity directory still obtains full admin power. The difference now is that it must wait out a public delay (1 h on Testnet, at least 2 days on mainnet) rather than act instantly. The docs' "keys held by different people" advice can't be followed with the provided tools.

**Recommendation.** Split `admin.ts` into three steps:
1. `prepare`: write the auth entry, nonce, expiration and payload hash to a file.
2. `sign --signer <key>`: run on each signer's own device, output one `{public_key, signature}`.
3. `submit`: sort, assemble, enforce-simulate and send. The SDK's `authorizeEntry` with a `signatureScVal` callback already supports this.

Refuse to generate signer keys off Testnet, and accept public-key-only identities there. Never accept secrets on argv.

#### SIS-22: Recorded Testnet deployment is the pre-timelock build

**Severity:** Low · **Location:** `deployments/testnet.env` (`SISONKE_WASM_HASH=52c4582b…`, `SISONKE_ADMIN=GCAD4LP7…`); `storage.rs:105-111`; `README.md:21`, `docs/CONTRACT.md:11-15`, `docs/INTEGRATION.md:10-11`

**Description.** The deployment that integrators are told to read is the instant-upgrade build: its hash is the "v1 wasm hash" of the superseded run in `UPGRADES.md:303`. Its admin is `GCAD4LP7…`, which is the local `sisonke-deployer` hot key. So on Testnet today SIS-01 is fully live, while every doc describes a timelocked multisig instance, and `bindings.sh` would generate a client without the timelock ABI. The new code also can't be installed onto that instance in place. If someone used its old `upgrade(hash)` to install this build (same `VERSION` 1 / `STORAGE_VERSION` 1), `DataKey::UpgradeDelay` would be absent, and `storage::upgrade_delay`'s `unwrap()` would trap in `propose_upgrade`, `set_upgrade_delay`, `upgrade_delay()` and `info()` forever. That freezes the code (no proposal can ever be stored) and breaks the web header read. `upgrade.sh` can't do this by accident, because it first calls `pending_upgrade()`, which the old build lacks. PLAN/UPGRADES say "fresh pre-release redeploy", but nothing marks the recorded instance as superseded.

**Recommendation.** Redeploy (`FORCE=1 make deploy`) before publishing any docs that point at `deployments/testnet.env`, and keep the old id only as history in TRANSACTIONS.md. Make `upgrade_delay()` fail safe (`unwrap_or(MAX_UPGRADE_DELAY)`), so that an instance missing the key still gets the strictest delay rather than a trap. If an in-place path from the old build is ever wanted, treat it as a layout change (`STORAGE_VERSION` 2 with a `migrate` that writes the delay).

#### SIS-23: SIS-08 residual: funded spam is nearly free

**Severity:** Informational · **Location:** `lib.rs:190-217` with `lib.rs:741-746` (`deadline > now`, no minimum duration) and `lib.rs:727` (`amount > 0`); `docs/CONTRACT.md:261-262`, `docs/INTEGRATION.md:89-90`, AUDIT §9 SIS-08 row

**Description.** An attacker calls `create_and_fund(amount = 1, deadline = now + 1, title = "Refund from Acme…")`, then `reclaim` a ledger later. This costs 10⁻⁷ USDC for about 5 seconds, plus fees and rent. The victim's `Recipient` (and any `Arbiter`) index keeps the entry permanently, shown as a closed `Refunded` escrow with the attacker's title. "Costs the sender the full amount (which the recipient can then refund)" is therefore wrong: the sender gets the amount back by itself, and a recipient refund only spends the victim's fees. Unfunded spam is gone; cheap funded spam isn't.

**Recommendation.** Correct CONTRACT.md, INTEGRATION.md §7 and the remediation row. In the web app, collapse closed escrows the user never interacted with, and those below a minimum amount or with a lifetime under, say, an hour. If it matters on-chain, add a minimum duration (for example `deadline >= now + 1 h`) and/or a minimum amount.

#### SIS-24: Event/ABI gaps for upgrade watchers

**Severity:** Informational · **Location:** `lib.rs:586-587`, `lib.rs:610`, `scripts/upgrade.sh:167-180`

**Description.**
- Replacing a proposal emits a second `upgrade_proposed` but no `upgrade_cancelled` for the replaced hash, so an indexer that tracks open proposals by hash shows both.
- `upgrade()` takes no argument, so each signer's auth payload approves "run whatever is pending" rather than a specific hash. This is sound today (one slot, a re-proposal resets `eta`, and the signature expires after 100 ledgers), but an `upgrade(expected_hash)` that must equal the pending hash would make every co-signature explicit.
- `upgrade.sh`'s export check compares names only, so a v2 that brings back an instant `upgrade(new_wasm_hash)` passes it.
- `propose_upgrade` can't check that the wasm is uploaded (documented), so a banner may link a hash whose code isn't public yet.

**Recommendation.** Emit `upgrade_cancelled` (or put a `replaced: Option<BytesN<32>>` field on `upgrade_proposed`) when a proposal replaces another. Consider `upgrade(expected_hash)`. Check function signatures (`upgrade()` with zero params, `propose_upgrade(new_wasm_hash: BytesN<32>)`) in `upgrade.sh`. Have the banner check the `ContractCode` ledger entry and say "code not yet published" when it is missing.

#### SIS-25: Documentation precision

**Severity:** Informational · **Location:** `docs/UPGRADES.md:80, 16`; `lib.rs:431-432`; `types.rs:171`; `docs/PLAN.md:466`; `docs/CONTRACT.md` admin-writes table

**Description.**
- UPGRADES.md:80 says every failure of the account check is `Error(Contract, #5)`. In fact a bad signature is `Error(Crypto, InvalidInput)` (`crypto/mod.rs:89-96`), a missing account entry is a storage error, and every recoverable failure is re-raised as **`Error(Auth, InvalidAction)`** (`auth.rs:2496-2510`). `#5` appears only as a diagnostic argument. `upgrade-demo.sh:110` already accepts both.
- The `party_escrow_ids` doc comment and the `PartyPage` doc still say "oldest first". For recipient and arbiter the order is funding order, and PLAN I13 still says "creation order" (noted in PLAN §15, but not in the invariant).
- "Mainnet at least 2 days" (UPGRADES.md:16, README) is `deploy.sh` policy. The contract accepts 60 s on any network, so integrators must read `upgrade_delay()` rather than assume it.
- `propose_upgrade` can also return 143 (`Overflow`; unreachable in practice), which the admin-writes table omits.
- `upgrade-demo.sh`'s "execute before the eta must fail" step has a 60 s window. Slow RPC could make it succeed and abort the demo (fail-safe).

**Recommendation.** Fix the wording as above. State that the threshold applied to source-account credentials is stellar-core's, and that the scripts never use that path for the admin.

### R2.5 Updated verdicts for SIS-01 and SIS-08

| ID | Claimed | Verdict | Reason |
|---|---|---|---|
| SIS-01 | Fixed | **Partially fixed. Timelock: Fixed. Multisig: Mitigated in tooling only. Testnet: Not yet applied.** | The on-chain timelock is correct and has no bypass (R2.1). An upgrade now needs a public `upgrade_proposed` at least `upgrade_delay()` before it runs, during which either party can move every escrow's funds to a legitimate party. Residuals: the delay's protection is cooperative for payers (SIS-17); a matured proposal never expires (SIS-18); the multisig isn't enforced on-chain, its verification is incomplete (SIS-20), and the provided signing flow puts every key on one machine (SIS-21); the recorded Testnet instance is still the instant, single-key build (SIS-22). Residual severity: **Low**. `lock_upgrades` before mainnet remains the only complete fix. |
| SIS-08 | Fixed | **Fixed for unfunded spam; residual Informational (SIS-23).** | Unfunded and cancelled escrows can no longer reach a recipient's or arbiter's list (R2.3, no duplicates, ordering documented). Funded spam costs 1 stroop for one ledger plus fees, not "the full amount", so the remediation row and CONTRACT.md/INTEGRATION.md overstate the cost. |

### R2.6 Invariants for the new behaviour

- **T1 (no early code):** the executable changes only inside `upgrade()`, and only when the `PendingUpgrade` present at that call has `eta <= now`. Every `eta` was set to `proposed_at + delay` with `delay >= 60` and `delay >= ` every earlier delay. Holds (`lib.rs:572-626`).
- **T2 (one proposal):** at most one `PendingUpgrade` exists. Replacing it resets `proposed_at` and `eta`. `cancel_upgrade`, `lock_upgrades`, `accept_admin` and `upgrade` all remove it. Holds.
- **T3 (monotone delay):** `UpgradeDelay` never decreases and stays within 60 ..= 2 592 000. A pending `eta` is never changed by `set_upgrade_delay`. Holds.
- **T4 (lock is final):** after `lock_upgrades`, no `PendingUpgrade` exists and `propose_upgrade`/`upgrade` return 200 (in this code; future code is trust assumption 3). Holds.
- **T5 (exits independent of upgrades):** no exit function reads `UpgradeDelay` or `PendingUpgrade`, and pause never gates an exit. Exits are blocked only by `ensure_storage_current` (SIS-14/SIS-19). Holds. The user-facing meaning of "exit" is SIS-17.
- **T6 (proposal survives its delay):** every write that creates a proposal extends the instance to at least 60 days of TTL, which exceeds `MAX_UPGRADE_DELAY`, so a proposal can't archive before its `eta`. Holds, given the network `max_entry_ttl` exceeds 60 days.
- **T7 (funded-only counterparty index):** an escrow id is in `(recipient, Recipient)` and `(arbiter, Arbiter)` exactly once if and only if it has ever been `Funded`, appended at funding time. It is in `(payer, Payer)` exactly once from creation. PLAN I13 should be restated this way. Holds.
- **T8 (admin authority):** the contract enforces only `Admin.require_auth()`. "M-of-N, no single key" holds only while the admin account's on-chain configuration says so (SIS-20). For address credentials the host requires distinct, sorted, nonzero-weight signers whose total reaches the MEDIUM threshold (R2.2).

### R2.7 Round 2 remediation

Applied by the Coding agent (2026-10-29). Verification: `cargo fmt --check` and
`cargo clippy --all-targets -- -D warnings` clean; `make test` (wasm build, the ignored compiled-wasm
tests, both adversary suites) **178 passed, 0 failed**; `bash -n` on every script;
`npm run typecheck`. Not yet exercised on a network: the scripts' new paths and the fresh Testnet
redeploy.

| ID | Status | What changed, and where |
|---|---|---|
| SIS-17 | **Fixed (docs)**; a structural unilateral exit is not added | Restated everywhere (`lib.rs`, `types.rs`, `events.rs` docs, CONTRACT.md box and trust assumption 1, UPGRADES.md, INTEGRATION.md §2, README): during the delay either party can move each escrow's funds out of the new code's reach, but before the deadline only toward the counterparty (payer `release`, recipient `refund`) or via the arbiter; the payer alone can only `reclaim` after the deadline. Recommends deadlines shorter than `upgrade_delay()` for a unilateral exit; the banner text spells out what each role can do, and the app warns at create/fund when the deadline exceeds the delay. Pinned by `adversary_timelock::payer_cannot_recover_funds_alone_before_eta` (unchanged). |
| SIS-18 | **Fixed (contract)** | `PendingUpgrade.expires_at = eta + UPGRADE_WINDOW` (7 days, saturating); `upgrade` after it fails with **207 `UpgradeExpired`**, and the proposal must be made again (fresh delay). `ContractInfo.pending_upgrade_expires_at`; `upgrade_proposed` carries `expires_at`. Banner after `eta`: "can take effect at any moment until `<expires_at>`" (INTEGRATION.md §2). Tests: `timelock::proposal_runs_only_inside_its_window`, `adversary_timelock::stale_proposal_expires_after_the_window` (flipped). |
| SIS-19 | **Acknowledged (documented)**; no emergency fast path | CONTRACT.md Security model and UPGRADES.md "Versions": the pending-migration window is normally seconds (anyone can call `migrate` right after the upgrade; `upgrade.sh execute MIGRATE=1` does); if the migration itself is broken, the remedy is upgrade-forward, which waits a full delay (worst case up to 30 days), hence mandatory migration rehearsal. `propose_upgrade` stays allowed during a pending migration. The suggested "immediate rollback to the previous hash" path was not added: it would be a second upgrade path to secure, for a state that needs a broken release to reach. |
| SIS-20 | **Fixed (scripts)** | `multisig-admin.sh` ends every run (fresh or re-run) with a full Horizon check: master weight 0; low = med = high = M; exactly the expected N signers, each weight exactly 1; no unknown signers or other signer types; refuses otherwise (no "already configured" shortcut, and it refuses to build on an account that already has other signers). `THRESHOLD < 2` is always refused. `multisig-admin.sh verify <G…>` checks an existing account; `deploy.sh` off Testnet requires `ADMIN_SIGNER_KEYS` (+ `ADMIN_THRESHOLD`) and runs it on `ADMIN` before deploying. Exercised offline against sample Horizon payloads (bad high threshold, weight-2 signer, extra signer, enabled master, missing signer, pre-auth signer: all refused). |
| SIS-21 | **Fixed (scripts)**; one-process mode kept for Testnet | `admin.ts prepare <op> --out req.json` / `sign req.json --key <identity \| ->` / `submit req.json`. `sign` runs on each signer's own device (no network), recomputes the payload from the auth entry and passphrase, prints network / contract / admin / function / arguments (incl. the wasm hash) before signing, refuses a request whose summary doesn't match its entry and a second signature from the same key. `submit` sorts, assembles, enforce-simulates and sends. Secrets on argv are refused everywhere; duplicate signers are refused. Off Testnet `multisig-admin.sh` never generates signer keys (`SIGNERS=G…,G…,G…` public keys only). Exercised offline: two independent signatures assemble and verify over the unchanged payload; duplicate, tampered and argv-secret cases refused. |
| SIS-22 | **Fixed in code; redeploy pending (coordinator)** | `storage::upgrade_delay` falls back to `MAX_UPGRADE_DELAY` instead of trapping, so `propose_upgrade`, `set_upgrade_delay`, `upgrade_delay()` and `info()` never trap on a missing key (`adversary_timelock::missing_upgrade_delay_key_falls_back_to_the_max_delay`, flipped). `types.rs` and UPGRADES.md "Versions" state that the superseded instant-upgrade instance `CDYJ6GNKZCXTBSDETHTQDUTAYHLM577N46BQW4FU3ITDFMGDG3JJD2NY` must never be upgraded to this code (missing key; index double-insert, pinned by `escrow_indexed_by_old_code_gets_duplicated_on_fund`); it is history only. The fresh Testnet deploy happens after this round. |
| SIS-23 | **Fixed (docs)**; no on-chain minimum added | CONTRACT.md and INTEGRATION.md §7 now say funded spam costs ≈ 1 stroop for one ledger plus fees (the sender reclaims). Integrators must show the amount prominently and should collapse tiny / short-lived / self-reclaimed escrows the user never touched, and let users hide escrows. The §9 SIS-08 row's "costs the sender the full amount" is superseded by this. Pinned by `adversary_timelock::funded_spam_fills_a_victims_lists_for_free` (unchanged). |
| SIS-24 | **Fixed** | Replacing a proposal emits `upgrade_cancelled` (old hash) before `upgrade_proposed` (`timelock::replacing_a_proposal_cancels_the_old_one_first`). `upgrade(expected_wasm_hash)` binds every signature to the hash; any other is **206 `UpgradeHashMismatch`** (`timelock::upgrade_requires_the_pending_hash`, `adversary_timelock::upgrade_signature_is_bound_to_the_hash`, flipped). `upgraded` already carries the installed hash. `upgrade.sh` checks parameter types (`upgrade(BytesN<32>)`, `propose_upgrade(BytesN<32>)`, `cancel_upgrade()`, …, all escrow functions), not just names. INTEGRATION.md §2: the banner checks that the proposed wasm is published and treats unpublished code as hostile. Raising the delay also pushes a pending `eta` (`timelock::raising_the_delay_moves_a_pending_eta`, `adversary_timelock::raising_the_delay_pushes_the_pending_eta`, flipped). |
| SIS-25 | **Fixed (docs)** | UPGRADES.md: a failed account check surfaces as `Error(Auth, InvalidAction)` (re-raised in `auth.rs` ~2492; `#5` only in diagnostics); scripts never use source-account credentials for the admin. `party_escrow_ids` / `PartyPage` docs: creation order for payer, funding order for recipient/arbiter; PLAN I13 restated. "Mainnet ≥ 2 days" marked as deploy policy (read `upgrade_delay()`). `propose_upgrade`'s 143 listed. The demo's 60 s early-execute race documented as fail-safe. |

**SIS-01, updated after round 2:** *Timelock: Fixed* (no bypass; now also hash-bound, with a 7-day
execution window, and a raised delay applies to the pending proposal). *Multisig: Fixed in tooling*
(exact M-of-N verified on every run and before deploy off Testnet; independent-signer
prepare/sign/submit flow; no generated keys off Testnet), but still not enforceable on-chain: the
contract only calls `Admin.require_auth()`. *Testnet: pending the fresh redeploy.* Residual
severity **Low**. `lock_upgrades` before mainnet remains the only complete fix.
