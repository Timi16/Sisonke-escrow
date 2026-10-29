//! # sisonke-escrow
//!
//! A USDC escrow on Stellar with an optional, payer-chosen arbiter.
//!
//! One contract holds every escrow and all locked funds. The token is pinned
//! at construction. Status only moves forward, and every function checks the
//! current status before doing anything, which is what blocks duplicate
//! releases and refunds.
//!
//! Escrow writes follow the order of docs/PLAN.md §3.0: extend the instance
//! TTL → storage version (141) → load the escrow (100) → `require_auth` →
//! pause (inflows only) → status → time → remaining argument checks → write
//! state → transfer → event. A few checks sit earlier by design: `dispute`
//! checks that `by` is a party (105) right after auth, and `resolve` checks
//! that an arbiter exists (104) before auth. Admin writes skip the escrow
//! steps (`lock_upgrades` also checks the storage version; `accept_admin`
//! reads the pending admin before auth).
//!
//! The TTL extension is the only write before the checks above. A few checks
//! can run after some state is already written: the overflow checks (143) on
//! the id counter, the index counts and `TotalLocked`, and the transfer-delta
//! check (107) after the payer's transfer. A failing check returns an error,
//! and the host then rolls back every write of the call, so a refused call
//! never leaves a partial change.
//!
//! Guarantees:
//! - Funds only ever go to the escrow's own payer or recipient. No function
//!   takes a destination address.
//! - Neither party can pay themselves: only the payer (or the arbiter, in a
//!   dispute) can release, and the payer only gets funds back alone after the
//!   deadline, and only if no dispute was opened before it. This assumes the
//!   arbiter is independent: the payer chooses it, so a recipient must trust
//!   it before starting work.
//! - The admin can pause new escrows and funding, hand over the admin role,
//!   and upgrade the code after a public delay. It cannot sign for, move,
//!   freeze or re-time any escrow. Pause never blocks a way out.
//! - Only the payer's list shows an unfunded escrow; the recipient's and the
//!   arbiter's lists get it once it is funded.
//!
//! Upgrades work like Solidity's UUPS: the upgrade functions live in the
//! contract itself and swap the wasm while the address, storage and locked
//! funds stay put. New code could do anything, so an upgrade is timelocked:
//! `propose_upgrade` publishes the wasm hash, and `upgrade` can only install
//! it `upgrade_delay()` seconds later, within a 7-day window, and only if the
//! call names that exact hash. During the delay every exit function keeps
//! working, so either party can move an escrow's funds out of the new code's
//! reach: before the deadline only to the counterparty (the payer can
//! release, the recipient can refund) or through the arbiter; the payer alone
//! only gets funds back by reclaiming after the deadline. The delay can only
//! be raised, the admin should be a multisig account, and `lock_upgrades`
//! freezes the code for good.
//!
//! A version that changes the storage layout ships a permissionless
//! `migrate`; until it has run, every escrow write refuses with
//! `MigrationRequired`.

#![no_std]
// `create` and `create_and_fund` take the escrow terms directly so the
// generated clients and Stellar Lab show one plain argument per field. The
// lint also fires on the code `#[contractimpl]` generates, so allow it here.
#![allow(clippy::too_many_arguments)]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contractmeta, panic_with_error, token, Address, BytesN,
    ContractExecutable, Env, String, Vec,
};

pub use errors::Error;
pub use storage::{DAY_IN_LEDGERS, PAGE_SIZE, TTL_EXTEND_TO, TTL_THRESHOLD};
pub use types::{ContractInfo, DataKey, Escrow, EscrowView, PartyRole, PendingUpgrade, Status};

/// Bumped with every release of this code. Returned by `version()`.
pub const VERSION: u32 = 1;
/// The storage layout this code reads and writes. Bumped only when the
/// layout changes; the new version's `migrate` moves the data across.
pub const STORAGE_VERSION: u32 = 1;

// The same two numbers as wasm metadata, so scripts/upgrade.sh can read them
// from a wasm file before installing it (`stellar contract info meta`). The
// macro needs literals; `wasm_meta_matches_version_constants` checks they
// equal the constants above.
contractmeta!(key = "sisonke_version", val = "1");
contractmeta!(key = "sisonke_storage_version", val = "1");

/// Shortest allowed upgrade delay: one minute, so Testnet can demo the timelock.
pub const MIN_UPGRADE_DELAY: u64 = 60;
/// Longest allowed upgrade delay: 30 days.
pub const MAX_UPGRADE_DELAY: u64 = 30 * 86_400;
/// How long after its `eta` a proposal can still run: 7 days. Later it is
/// expired and must be proposed again, so an upgrade never lands long after
/// users stopped watching for it.
pub const UPGRADE_WINDOW: u64 = 7 * 86_400;

/// Title cap, in bytes (UTF-8), inclusive.
pub const MAX_TITLE_LEN: u32 = 64;
/// `deadline <= now + MAX_DURATION`, inclusive. 365 days in seconds.
pub const MAX_DURATION: u64 = 365 * 86_400;
/// Most ids one `get_escrows` call accepts.
pub const MAX_BATCH: u32 = 20;

#[contract]
pub struct SisonkeEscrow;

#[contractimpl]
impl SisonkeEscrow {
    /// Runs once, atomically with deploy, so it cannot be front-run.
    /// `token` is pinned for every escrow; the `decimals()` call makes deploy
    /// fail if it isn't a token contract. `upgrade_delay` (seconds, between
    /// `MIN_UPGRADE_DELAY` and `MAX_UPGRADE_DELAY`) is how long every proposed
    /// upgrade must wait before it can run; it can later only be raised.
    pub fn __constructor(env: Env, admin: Address, token: Address, upgrade_delay: u64) {
        if !(MIN_UPGRADE_DELAY..=MAX_UPGRADE_DELAY).contains(&upgrade_delay) {
            panic_with_error!(&env, Error::InvalidUpgradeDelay);
        }
        token::Client::new(&env, &token).decimals();
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_next_id(&env, 1);
        storage::set_total_locked(&env, 0);
        storage::set_paused(&env, false);
        storage::set_upgrades_locked(&env, false);
        storage::set_storage_version(&env, STORAGE_VERSION);
        storage::set_upgrade_delay(&env, upgrade_delay);
        storage::extend_instance(&env);
        events::init(&env, &admin, &token, VERSION, upgrade_delay);
    }

    // ======================================================= escrow writes

    /// Creates an escrow in `Created` status. Nothing is locked yet; call
    /// `fund` next, or use `create_and_fund` to do both in one transaction.
    /// Only the payer's index lists it until it is funded, so nobody can fill
    /// someone else's list with unfunded escrows.
    ///
    /// `arbiter` is optional and fixed for good: without one there is no
    /// dispute path. `terms_hash` is the sha256 of the off-chain agreement.
    ///
    /// Signer: `payer`. Refused while paused. Returns the new escrow id.
    pub fn create(
        env: Env,
        payer: Address,
        recipient: Address,
        arbiter: Option<Address>,
        amount: i128,
        deadline: u64,
        title: String,
        terms_hash: Option<BytesN<32>>,
    ) -> Result<u64, Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        payer.require_auth();
        Self::ensure_not_paused(&env)?;
        let escrow = Self::new_escrow(
            &env, payer, recipient, arbiter, amount, deadline, title, terms_hash,
        )?;
        storage::save(&env, &escrow);
        storage::index_push(&env, &escrow.payer, PartyRole::Payer, escrow.id)?;
        events::created(&env, &escrow);
        Ok(escrow.id)
    }

    /// Locks the escrow amount: payer → contract. Status becomes `Funded`.
    ///
    /// Signer: `payer`. Allowed when `Created`, before the deadline, and not
    /// paused.
    pub fn fund(env: Env, id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        escrow.payer.require_auth();
        Self::ensure_not_paused(&env)?;
        if escrow.status != Status::Created {
            return Err(Error::InvalidStatus);
        }
        if env.ledger().timestamp() >= escrow.deadline {
            return Err(Error::DeadlinePassed);
        }
        Self::mark_funded(&env, &mut escrow)?;
        storage::save(&env, &escrow);
        Self::index_counterparties(&env, &escrow)?;
        Self::pull_funds(&env, &escrow)?;
        events::funded(&env, &escrow);
        Ok(())
    }

    /// `create` and `fund` in one transaction, with one signature from the
    /// payer covering the call and the token transfer. The default path.
    ///
    /// Signer: `payer`. Refused while paused. Returns the new escrow id.
    pub fn create_and_fund(
        env: Env,
        payer: Address,
        recipient: Address,
        arbiter: Option<Address>,
        amount: i128,
        deadline: u64,
        title: String,
        terms_hash: Option<BytesN<32>>,
    ) -> Result<u64, Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        payer.require_auth();
        Self::ensure_not_paused(&env)?;
        // `new_escrow` guarantees status `Created` and `deadline > now`,
        // which is everything `fund` checks.
        let mut escrow = Self::new_escrow(
            &env, payer, recipient, arbiter, amount, deadline, title, terms_hash,
        )?;
        Self::mark_funded(&env, &mut escrow)?;
        storage::save(&env, &escrow);
        storage::index_push(&env, &escrow.payer, PartyRole::Payer, escrow.id)?;
        Self::index_counterparties(&env, &escrow)?;
        Self::pull_funds(&env, &escrow)?;
        events::created(&env, &escrow);
        events::funded(&env, &escrow);
        Ok(escrow.id)
    }

    /// Pays the whole amount to the recipient: contract → recipient.
    /// Status becomes `Released`. Final.
    ///
    /// Signer: `payer`. Allowed when `Funded` or `Disputed` (conceding a
    /// dispute), at any time.
    pub fn release(env: Env, id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        escrow.payer.require_auth();
        Self::ensure_locked(&escrow)?;
        let (signer, amount) = (escrow.payer.clone(), escrow.amount);
        Self::close(&env, &mut escrow, Status::Released, &signer, amount, 0)?;
        Self::pay_out(&env, &escrow, &escrow.recipient, amount);
        events::released(&env, &escrow);
        Ok(())
    }

    /// The recipient sends the whole amount back: contract → payer.
    /// Status becomes `Refunded`. Final.
    ///
    /// Signer: `recipient`. Allowed when `Funded` or `Disputed` (conceding a
    /// dispute), at any time.
    pub fn refund(env: Env, id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        escrow.recipient.require_auth();
        Self::ensure_locked(&escrow)?;
        let (signer, amount) = (escrow.recipient.clone(), escrow.amount);
        Self::close(&env, &mut escrow, Status::Refunded, &signer, 0, amount)?;
        Self::pay_out(&env, &escrow, &escrow.payer, amount);
        events::refunded(&env, &escrow);
        Ok(())
    }

    /// The payer takes the whole amount back once the deadline has passed:
    /// contract → payer. Status becomes `Refunded`. Final.
    ///
    /// Signer: `payer`. Allowed when `Funded` (not `Disputed`) and
    /// `now >= deadline`.
    pub fn reclaim(env: Env, id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        escrow.payer.require_auth();
        if escrow.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }
        if env.ledger().timestamp() < escrow.deadline {
            return Err(Error::DeadlineNotReached);
        }
        let (signer, amount) = (escrow.payer.clone(), escrow.amount);
        Self::close(&env, &mut escrow, Status::Refunded, &signer, 0, amount)?;
        Self::pay_out(&env, &escrow, &escrow.payer, amount);
        events::reclaimed(&env, &escrow);
        Ok(())
    }

    /// Opens a dispute, handing the decision to the escrow's arbiter. From
    /// now on the payer cannot reclaim. Nothing moves.
    ///
    /// Signer: `by`, which must be the payer or the recipient. Allowed when
    /// `Funded`, the escrow has an arbiter, and `now < deadline`.
    pub fn dispute(env: Env, id: u64, by: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        by.require_auth();
        if by != escrow.payer && by != escrow.recipient {
            return Err(Error::NotParty);
        }
        if escrow.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }
        if escrow.arbiter.is_none() {
            return Err(Error::NoArbiter);
        }
        let now = env.ledger().timestamp();
        if now >= escrow.deadline {
            return Err(Error::DeadlinePassed);
        }
        escrow.status = Status::Disputed;
        escrow.disputed_at = now;
        escrow.disputed_by = Some(by.clone());
        escrow.updated_ledger = env.ledger().sequence();
        storage::save(&env, &escrow);
        events::disputed(&env, id, &by);
        Ok(())
    }

    /// The arbiter divides a disputed escrow: `recipient_amount` to the
    /// recipient, the rest to the payer. Status becomes `Released` (all to
    /// the recipient), `Refunded` (all to the payer) or `Split`. Final.
    ///
    /// Signer: the escrow's arbiter. Allowed only when `Disputed`, with
    /// `0 <= recipient_amount <= amount`.
    pub fn resolve(env: Env, id: u64, recipient_amount: i128) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        // Checked before auth: with no arbiter there is no one to authorize.
        let arbiter = escrow.arbiter.clone().ok_or(Error::NoArbiter)?;
        arbiter.require_auth();
        if escrow.status != Status::Disputed {
            return Err(Error::InvalidStatus);
        }
        if recipient_amount < 0 || recipient_amount > escrow.amount {
            return Err(Error::InvalidSplit);
        }
        let payer_amount = escrow.amount - recipient_amount;
        let status = if payer_amount == 0 {
            Status::Released
        } else if recipient_amount == 0 {
            Status::Refunded
        } else {
            Status::Split
        };
        Self::close(
            &env,
            &mut escrow,
            status,
            &arbiter,
            recipient_amount,
            payer_amount,
        )?;
        if recipient_amount > 0 {
            Self::pay_out(&env, &escrow, &escrow.recipient, recipient_amount);
        }
        if payer_amount > 0 {
            Self::pay_out(&env, &escrow, &escrow.payer, payer_amount);
        }
        events::resolved(&env, id, &arbiter, recipient_amount, payer_amount, status);
        Ok(())
    }

    /// Closes an escrow that was never funded. Nothing moves.
    /// Status becomes `Cancelled`. Final.
    ///
    /// Signer: `payer`. Allowed when `Created`, at any time.
    pub fn cancel(env: Env, id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        let mut escrow = storage::load(&env, id)?;
        escrow.payer.require_auth();
        if escrow.status != Status::Created {
            return Err(Error::InvalidStatus);
        }
        let signer = escrow.payer.clone();
        Self::close(&env, &mut escrow, Status::Cancelled, &signer, 0, 0)?;
        events::cancelled(&env, &escrow);
        Ok(())
    }

    /// Keeps an escrow record alive for another 120 days if fewer than 60
    /// remain. Anyone may call it (a keeper, the web app); it changes nothing
    /// else and emits nothing.
    pub fn extend_escrow_ttl(env: Env, id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        if !storage::extend_escrow(&env, id) {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Like `extend_escrow_ttl`, for a party's index count and one page.
    /// Missing entries are skipped. Anyone may call it.
    pub fn extend_index_ttl(
        env: Env,
        party: Address,
        role: PartyRole,
        page: u32,
    ) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::extend_index(&env, &party, role, page);
        Ok(())
    }

    // ================================================================= reads

    /// One escrow plus whether its deadline has passed.
    pub fn get_escrow(env: Env, id: u64) -> Result<EscrowView, Error> {
        let escrow = storage::load(&env, id)?;
        Ok(Self::view(&env, escrow))
    }

    /// Batch read for the dashboard, in the order given. Ids that do not
    /// exist are skipped rather than failing the whole call. At most
    /// `MAX_BATCH` ids.
    pub fn get_escrows(env: Env, ids: Vec<u64>) -> Result<Vec<EscrowView>, Error> {
        if ids.len() > MAX_BATCH {
            return Err(Error::BatchTooLarge);
        }
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(escrow) = storage::try_load(&env, id) {
                out.push_back(Self::view(&env, escrow));
            }
        }
        Ok(out)
    }

    /// Number of escrows ever created. Ids run from 1 to this value.
    pub fn escrow_count(env: Env) -> u64 {
        storage::peek_next_id(&env) - 1
    }

    /// How many escrows `party` has in `role`, across all pages.
    pub fn party_escrow_count(env: Env, party: Address, role: PartyRole) -> u32 {
        storage::party_count(&env, &party, role)
    }

    /// One page of at most `PAGE_SIZE` escrow ids for `party` in `role`.
    /// Page `n` holds entries `n * 50 ..`; empty past the end. Creation
    /// order for `Payer`, funding order for `Recipient` and `Arbiter`.
    pub fn party_escrow_ids(env: Env, party: Address, role: PartyRole, page: u32) -> Vec<u64> {
        storage::party_page(&env, &party, role, page)
    }

    /// Sum of the amounts of every `Funded` and `Disputed` escrow.
    pub fn total_locked(env: Env) -> i128 {
        storage::total_locked(&env)
    }

    /// The token every escrow uses.
    pub fn token(env: Env) -> Address {
        storage::token(&env)
    }

    /// The admin: pauses inflows and authorizes upgrades. Cannot touch escrows.
    pub fn admin(env: Env) -> Address {
        storage::admin(&env)
    }

    /// The address `propose_admin` named, until it calls `accept_admin`.
    pub fn pending_admin(env: Env) -> Option<Address> {
        storage::pending_admin(&env)
    }

    /// `true` while `create`, `create_and_fund` and `fund` are refused.
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    /// `false` once `lock_upgrades` has been called; the code is then final.
    pub fn upgrades_enabled(env: Env) -> bool {
        !storage::upgrades_locked(&env)
    }

    /// Seconds a proposed upgrade must wait before `upgrade` can run it.
    pub fn upgrade_delay(env: Env) -> u64 {
        storage::upgrade_delay(&env)
    }

    /// The proposed upgrade, if any: its wasm hash and the earliest time
    /// (`eta`) and latest time (`expires_at`) it can run. Until `eta` either
    /// party can still move each escrow's funds out of the new code's reach.
    pub fn pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        storage::pending_upgrade(&env)
    }

    /// Version of the code currently running.
    pub fn version() -> u32 {
        VERSION
    }

    /// Layout version of the stored data. Equal to the code's
    /// `STORAGE_VERSION` unless a `migrate` is pending.
    pub fn storage_version(env: Env) -> u32 {
        storage::storage_version(&env)
    }

    /// Every setting and counter above in one call.
    pub fn info(env: Env) -> ContractInfo {
        let pending = storage::pending_upgrade(&env);
        ContractInfo {
            version: VERSION,
            storage_version: storage::storage_version(&env),
            admin: storage::admin(&env),
            pending_admin: storage::pending_admin(&env),
            token: storage::token(&env),
            paused: storage::is_paused(&env),
            upgrades_locked: storage::upgrades_locked(&env),
            escrow_count: storage::peek_next_id(&env) - 1,
            total_locked: storage::total_locked(&env),
            upgrade_delay: storage::upgrade_delay(&env),
            pending_upgrade_hash: pending.as_ref().map(|p| p.wasm_hash.clone()),
            pending_upgrade_eta: pending.as_ref().map(|p| p.eta),
            pending_upgrade_expires_at: pending.map(|p| p.expires_at),
        }
    }

    // ================================================================= admin

    /// Pauses or unpauses inflows: `create`, `create_and_fund` and `fund`.
    /// Every way out (release, refund, reclaim, dispute, resolve, cancel)
    /// keeps working. Idempotent. Signer: admin.
    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        storage::set_paused(&env, paused);
        events::paused(&env, paused);
        Ok(())
    }

    /// Step one of an admin handover. Nothing changes until `new_admin` calls
    /// `accept_admin`, so a typo cannot lose the admin role. Proposing again
    /// replaces the pending admin. Signer: current admin.
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        storage::set_pending_admin(&env, &new_admin);
        events::admin_proposed(&env, &new_admin);
        Ok(())
    }

    /// Withdraws a pending proposal. Signer: current admin.
    pub fn cancel_admin_proposal(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        if storage::pending_admin(&env).is_none() {
            return Err(Error::NoPendingAdmin);
        }
        storage::clear_pending_admin(&env);
        events::admin_proposal_cancelled(&env);
        Ok(())
    }

    /// Step two of an admin handover. The old admin loses every power here,
    /// and any upgrade it proposed is cancelled. Signer: the pending admin.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        let new_admin = storage::pending_admin(&env).ok_or(Error::NoPendingAdmin)?;
        new_admin.require_auth();
        let previous = storage::admin(&env);
        storage::set_admin(&env, &new_admin);
        storage::clear_pending_admin(&env);
        // An upgrade proposed by the old admin doesn't survive the handover;
        // the new admin must propose (and wait) again.
        Self::clear_pending_upgrade(&env);
        events::admin_changed(&env, &new_admin, &previous);
        Ok(())
    }

    // ============================================================== upgrades

    /// Step one of an upgrade: names already-uploaded wasm and starts the
    /// public delay. `upgrade` can run it from `eta = now + upgrade_delay()`
    /// until `expires_at = eta + UPGRADE_WINDOW`; after that it has to be
    /// proposed again, with a fresh delay. Proposing again replaces the
    /// proposal (with an `upgrade_cancelled` event for the old one) and
    /// restarts the delay. Nothing changes for escrows: during the delay
    /// every exit function keeps working, so either party can move the funds
    /// out of the new code's reach; before the deadline that means toward the
    /// counterparty or through the arbiter (docs/CONTRACT.md, trust
    /// assumption #1). Signer: admin.
    ///
    /// Upload the wasm first (`stellar contract upload`) and pass its hash.
    /// Allowed while a migration is pending, so a broken version can always
    /// be replaced.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        if storage::upgrades_locked(&env) {
            return Err(Error::UpgradesLocked);
        }
        let now = env.ledger().timestamp();
        let eta = now
            .checked_add(storage::upgrade_delay(&env))
            .ok_or(Error::Overflow)?;
        let pending = PendingUpgrade {
            wasm_hash: new_wasm_hash,
            proposed_at: now,
            eta,
            // Saturating: an expiry past the end of time is just "never".
            expires_at: eta.saturating_add(UPGRADE_WINDOW),
        };
        Self::clear_pending_upgrade(&env);
        storage::set_pending_upgrade(&env, &pending);
        events::upgrade_proposed(&env, &pending);
        Ok(())
    }

    /// Withdraws the pending upgrade proposal. Signer: admin.
    pub fn cancel_upgrade(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        if storage::pending_upgrade(&env).is_none() {
            return Err(Error::NoPendingUpgrade);
        }
        Self::clear_pending_upgrade(&env);
        Ok(())
    }

    /// Step two: replaces this contract's code with the proposed wasm, like
    /// UUPS `upgradeTo`, between the proposal's `eta` and `expires_at`.
    /// `expected_wasm_hash` must be the pending hash, so every signature on
    /// this call approves one specific, reviewed piece of code. The address,
    /// all storage and all locked funds stay the same; the new code runs
    /// from the next call. Signer: admin.
    ///
    /// Only a plain wasm hash is ever installed: an executable reference
    /// would hand control of the code to another account. If the new code
    /// changes the storage layout, call its `migrate` next (anyone can).
    pub fn upgrade(env: Env, expected_wasm_hash: BytesN<32>) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        if storage::upgrades_locked(&env) {
            return Err(Error::UpgradesLocked);
        }
        let pending = storage::pending_upgrade(&env).ok_or(Error::NoPendingUpgrade)?;
        if pending.wasm_hash != expected_wasm_hash {
            return Err(Error::UpgradeHashMismatch);
        }
        let now = env.ledger().timestamp();
        if now < pending.eta {
            return Err(Error::UpgradeTooEarly);
        }
        if now > pending.expires_at {
            return Err(Error::UpgradeExpired);
        }
        // Cleared first, so the new code never starts with a stale proposal.
        storage::clear_pending_upgrade(&env);
        events::upgraded(&env, &pending.wasm_hash, VERSION);
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(pending.wasm_hash));
        Ok(())
    }

    /// Raises the upgrade delay. Increase only: a lower delay would itself
    /// need a delay to be safe. A pending proposal is held to the new delay
    /// too: its `eta` moves to `proposed_at + delay` if that is later (and
    /// its `expires_at` with it). Signer: admin.
    pub fn set_upgrade_delay(env: Env, delay: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        storage::admin(&env).require_auth();
        if !(MIN_UPGRADE_DELAY..=MAX_UPGRADE_DELAY).contains(&delay) {
            return Err(Error::InvalidUpgradeDelay);
        }
        let previous = storage::upgrade_delay(&env);
        if delay < previous {
            return Err(Error::UpgradeDelayDecrease);
        }
        storage::set_upgrade_delay(&env, delay);
        let pending_eta = storage::pending_upgrade(&env).map(|mut pending| {
            let eta = pending.proposed_at.saturating_add(delay);
            if eta > pending.eta {
                pending.eta = eta;
                pending.expires_at = eta.saturating_add(UPGRADE_WINDOW);
                storage::set_pending_upgrade(&env, &pending);
            }
            pending.eta
        });
        events::upgrade_delay_changed(&env, previous, delay, pending_eta);
        Ok(())
    }

    /// Freezes the code permanently: `propose_upgrade` and `upgrade` fail
    /// from now on, for every admin, and any pending proposal is cancelled.
    /// Cannot be undone. Refused while a migration is pending, so a
    /// half-migrated contract can never be frozen. Signer: admin.
    pub fn lock_upgrades(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        Self::ensure_storage_current(&env)?;
        storage::admin(&env).require_auth();
        if storage::upgrades_locked(&env) {
            return Err(Error::UpgradesLocked);
        }
        Self::clear_pending_upgrade(&env);
        storage::set_upgrades_locked(&env, true);
        events::upgrades_locked(&env);
        Ok(())
    }

    /// Moves stored data to this code's layout. Permissionless, so a
    /// migration can be finished even if the admin key is lost.
    ///
    /// v1 is the first layout, so there is never anything to migrate:
    /// `NothingToMigrate` when current, `MigrationRequired` if the data is
    /// from a newer version (this code was rolled back to after a migration).
    pub fn migrate(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        if storage::storage_version(&env) == STORAGE_VERSION {
            return Err(Error::NothingToMigrate);
        }
        Err(Error::MigrationRequired)
    }
}

// Internal helpers. Not part of the contract interface.
impl SisonkeEscrow {
    /// Removes a pending upgrade proposal, if any, with an `upgrade_cancelled`
    /// event.
    fn clear_pending_upgrade(env: &Env) {
        if let Some(pending) = storage::pending_upgrade(env) {
            storage::clear_pending_upgrade(env);
            events::upgrade_cancelled(env, &pending.wasm_hash);
        }
    }

    /// Writes are only safe on data in the layout this code was written for.
    fn ensure_storage_current(env: &Env) -> Result<(), Error> {
        if storage::storage_version(env) != STORAGE_VERSION {
            return Err(Error::MigrationRequired);
        }
        Ok(())
    }

    fn ensure_not_paused(env: &Env) -> Result<(), Error> {
        if storage::is_paused(env) {
            return Err(Error::Paused);
        }
        Ok(())
    }

    /// Funds are in the contract: `Funded` or `Disputed`.
    fn ensure_locked(escrow: &Escrow) -> Result<(), Error> {
        match escrow.status {
            Status::Funded | Status::Disputed => Ok(()),
            _ => Err(Error::InvalidStatus),
        }
    }

    /// Validates the terms and builds a `Created` escrow with a fresh id.
    /// Writes nothing but the id counter, and only once every check passed.
    fn new_escrow(
        env: &Env,
        payer: Address,
        recipient: Address,
        arbiter: Option<Address>,
        amount: i128,
        deadline: u64,
        title: String,
        terms_hash: Option<BytesN<32>>,
    ) -> Result<Escrow, Error> {
        let now = env.ledger().timestamp();
        let this = env.current_contract_address();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if payer == recipient {
            return Err(Error::SameParty);
        }
        if payer == this || recipient == this || arbiter.as_ref() == Some(&this) {
            return Err(Error::InvalidParty);
        }
        if let Some(a) = &arbiter {
            if *a == payer || *a == recipient {
                return Err(Error::InvalidArbiter);
            }
        }
        if deadline <= now {
            return Err(Error::DeadlineInPast);
        }
        if deadline > now.saturating_add(MAX_DURATION) {
            return Err(Error::DeadlineTooFar);
        }
        Self::validate_title(&title)?;

        Ok(Escrow {
            id: storage::take_next_id(env)?,
            payer,
            recipient,
            arbiter,
            token: storage::token(env),
            amount,
            deadline,
            title,
            terms_hash,
            status: Status::Created,
            created_at: now,
            created_ledger: env.ledger().sequence(),
            funded_at: 0,
            disputed_at: 0,
            disputed_by: None,
            closed_at: 0,
            closed_by: None,
            paid_to_recipient: 0,
            paid_to_payer: 0,
            updated_ledger: env.ledger().sequence(),
        })
    }

    /// At most `MAX_TITLE_LEN` bytes (126), valid UTF-8 with no ASCII control
    /// bytes (128). The host doesn't check UTF-8 itself, so the bytes are
    /// copied into a fixed buffer (the cap bounds the cost) and decoded.
    /// Above ASCII only whole UTF-8 sequences appear, whose bytes are all
    /// >= 0x80, so a byte scan finds every control character.
    fn validate_title(title: &String) -> Result<(), Error> {
        let len = title.len();
        if len > MAX_TITLE_LEN {
            return Err(Error::TitleTooLong);
        }
        let mut buf = [0u8; MAX_TITLE_LEN as usize];
        let bytes = &mut buf[..len as usize];
        title.copy_into_slice(bytes);
        let text = core::str::from_utf8(bytes).map_err(|_| Error::InvalidTitle)?;
        if text.bytes().any(|b| b < 0x20 || b == 0x7f) {
            return Err(Error::InvalidTitle);
        }
        Ok(())
    }

    /// Adds a newly funded escrow to its recipient's and arbiter's index. The
    /// payer's index got it at creation.
    fn index_counterparties(env: &Env, escrow: &Escrow) -> Result<(), Error> {
        storage::index_push(env, &escrow.recipient, PartyRole::Recipient, escrow.id)?;
        if let Some(arbiter) = &escrow.arbiter {
            storage::index_push(env, arbiter, PartyRole::Arbiter, escrow.id)?;
        }
        Ok(())
    }

    /// Marks the escrow `Funded` and counts its amount as locked. The caller
    /// saves the escrow, then calls `pull_funds`.
    fn mark_funded(env: &Env, escrow: &mut Escrow) -> Result<(), Error> {
        storage::add_locked(env, escrow.amount)?;
        escrow.status = Status::Funded;
        escrow.funded_at = env.ledger().timestamp();
        escrow.updated_ledger = env.ledger().sequence();
        Ok(())
    }

    /// payer → contract, then checks the contract received exactly `amount`,
    /// which refuses any token that skims or rebases on transfer.
    fn pull_funds(env: &Env, escrow: &Escrow) -> Result<(), Error> {
        let token = token::Client::new(env, &escrow.token);
        let this = env.current_contract_address();
        let before = token.balance(&this);
        token.transfer(&escrow.payer, &this, &escrow.amount);
        let after = token.balance(&this);
        if after.checked_sub(before) != Some(escrow.amount) {
            return Err(Error::TransferMismatch);
        }
        Ok(())
    }

    /// Moves the escrow to a final status, records who closed it and what
    /// each side gets, releases the amount from `TotalLocked` if it was
    /// locked, and saves. Runs before any transfer.
    fn close(
        env: &Env,
        escrow: &mut Escrow,
        status: Status,
        signer: &Address,
        to_recipient: i128,
        to_payer: i128,
    ) -> Result<(), Error> {
        if escrow.status != Status::Created {
            storage::sub_locked(env, escrow.amount)?;
        }
        escrow.status = status;
        escrow.paid_to_recipient = to_recipient;
        escrow.paid_to_payer = to_payer;
        escrow.closed_at = env.ledger().timestamp();
        escrow.closed_by = Some(signer.clone());
        escrow.updated_ledger = env.ledger().sequence();
        storage::save(env, escrow);
        Ok(())
    }

    /// Sends funds held by this contract to `to`, which is always the
    /// escrow's own payer or recipient, in the escrow's own token.
    fn pay_out(env: &Env, escrow: &Escrow, to: &Address, amount: i128) {
        token::Client::new(env, &escrow.token).transfer(
            &env.current_contract_address(),
            to,
            &amount,
        );
    }

    fn view(env: &Env, escrow: Escrow) -> EscrowView {
        let deadline_passed = env.ledger().timestamp() >= escrow.deadline;
        EscrowView {
            escrow,
            deadline_passed,
        }
    }
}
