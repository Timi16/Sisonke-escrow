//! Test-only stand-in for "sisonke-escrow v2". **Never deploy it to the
//! production instance**; `make upgrade-demo` uses it on a separate,
//! throwaway Testnet instance only.
//!
//! sisonke-escrow's upgrade tests upgrade a live escrow contract to this wasm
//! and check that the address, storage and locked funds all survive. The
//! types below are copied by hand from sisonke-escrow, not imported: if v1's
//! stored layout ever drifts from what is written here, decoding an escrow
//! fails and the upgrade tests catch it.
//!
//! It also exercises the v2 migration pattern (docs/UPGRADES.md): a
//! permissionless `migrate` that moves `StorageVersion` from 1 to 2, and the
//! same timelocked `propose_upgrade` → `upgrade(expected_wasm_hash)` with an
//! expiry window (plus `cancel_upgrade` and `lock_upgrades`) as v1, still honouring `UpgradesLocked`, so tests can
//! roll back.
//!
//! Rebuild the committed wasm after changing this file (`make fixture`):
//!   stellar contract build --package sisonke-upgrade-fixture
//!   cp target/wasm32v1-none/release/sisonke_upgrade_fixture.wasm contracts/sisonke-escrow/testdata/upgrade_fixture.wasm

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN,
    ContractExecutable, Env, String, Vec,
};

const VERSION: u32 = 2;
const STORAGE_VERSION: u32 = 2;
/// Same execution window as v1.
const UPGRADE_WINDOW: u64 = 7 * 86_400;

// Read by scripts/upgrade.sh before installing, like v1's.
soroban_sdk::contractmeta!(key = "sisonke_version", val = "2");
soroban_sdk::contractmeta!(key = "sisonke_storage_version", val = "2");

/// Every v1 `DataKey` variant, named exactly as in v1. An enum variant is
/// stored as `[Symbol(name), fields...]`, so the names and field types have
/// to match. `FixtureMarker` is new in "v2" (hence its storage-version bump).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Token,
    NextId,
    TotalLocked,
    Paused,
    UpgradesLocked,
    StorageVersion,
    Escrow(u64),
    PartyCount(Address, PartyRole),
    PartyPage(Address, PartyRole, u32),
    UpgradeDelay,
    PendingUpgrade,
    FixtureMarker,
}

/// Copy of v1's `PendingUpgrade`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub wasm_hash: BytesN<32>,
    pub proposed_at: u64,
    pub eta: u64,
    pub expires_at: u64,
}

/// Copy of v1's `Status`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Created,
    Funded,
    Disputed,
    Released,
    Refunded,
    Split,
    Cancelled,
}

/// Copy of v1's `PartyRole`; part of the index keys.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PartyRole {
    Payer,
    Recipient,
    Arbiter,
}

/// Copy of v1's `Escrow`. A struct is stored as a map keyed by field name.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub id: u64,
    pub payer: Address,
    pub recipient: Address,
    pub arbiter: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub deadline: u64,
    pub title: String,
    pub terms_hash: Option<BytesN<32>>,
    pub status: Status,
    pub created_at: u64,
    pub created_ledger: u32,
    pub funded_at: u64,
    pub disputed_at: u64,
    pub disputed_by: Option<Address>,
    pub closed_at: u64,
    pub closed_by: Option<Address>,
    pub paid_to_recipient: i128,
    pub paid_to_payer: i128,
    pub updated_ledger: u32,
}

/// Same codes as v1 for the same meaning.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FixtureError {
    NotFound = 100,
    MigrationRequired = 141,
    NothingToMigrate = 142,
    UpgradesLocked = 200,
    NoPendingUpgrade = 203,
    UpgradeTooEarly = 204,
    UpgradeHashMismatch = 206,
    UpgradeExpired = 207,
}

/// Same shape as v1's `migrated` event.
#[contractevent(topics = ["sisonke", "migrated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Migrated {
    pub from: u32,
    pub to: u32,
}

#[contract]
pub struct UpgradeFixture;

#[contractimpl]
impl UpgradeFixture {
    pub fn version() -> u32 {
        VERSION
    }

    pub fn storage_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0)
    }

    pub fn escrow_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get::<_, u64>(&DataKey::NextId)
            .unwrap_or(1)
            - 1
    }

    pub fn total_locked(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalLocked)
            .unwrap_or(0)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn party_escrow_count(env: Env, party: Address, role: PartyRole) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PartyCount(party, role))
            .unwrap_or(0)
    }

    pub fn party_escrow_ids(env: Env, party: Address, role: PartyRole, page: u32) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::PartyPage(party, role, page))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// The raw stored record, decoded with the copied types.
    pub fn get_escrow(env: Env, id: u64) -> Result<Escrow, FixtureError> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .ok_or(FixtureError::NotFound)
    }

    /// `true` once `migrate` has run.
    pub fn migrated(env: Env) -> bool {
        env.storage().instance().has(&DataKey::FixtureMarker)
    }

    /// Storage layout 1 → 2. Permissionless; runs exactly once.
    pub fn migrate(env: Env) -> Result<(), FixtureError> {
        let stored = Self::storage_version(env.clone());
        if stored == STORAGE_VERSION {
            return Err(FixtureError::NothingToMigrate);
        }
        if stored != STORAGE_VERSION - 1 {
            return Err(FixtureError::MigrationRequired);
        }
        env.storage().instance().set(&DataKey::FixtureMarker, &true);
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION);
        Migrated {
            from: stored,
            to: STORAGE_VERSION,
        }
        .publish(&env);
        Ok(())
    }

    pub fn upgrade_delay(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap()
    }

    pub fn pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        env.storage().instance().get(&DataKey::PendingUpgrade)
    }

    pub fn upgrades_enabled(env: Env) -> bool {
        !Self::locked(&env)
    }

    /// Same timelock as v1: admin-gated, honours `UpgradesLocked`, and the
    /// proposal can run from `now + upgrade_delay`.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), FixtureError> {
        Self::admin(env.clone()).require_auth();
        if Self::locked(&env) {
            return Err(FixtureError::UpgradesLocked);
        }
        let now = env.ledger().timestamp();
        let eta = now + Self::upgrade_delay(env.clone());
        let pending = PendingUpgrade {
            wasm_hash: new_wasm_hash,
            proposed_at: now,
            eta,
            expires_at: eta.saturating_add(UPGRADE_WINDOW),
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &pending);
        Ok(())
    }

    pub fn cancel_upgrade(env: Env) -> Result<(), FixtureError> {
        Self::admin(env.clone()).require_auth();
        if Self::pending_upgrade(env.clone()).is_none() {
            return Err(FixtureError::NoPendingUpgrade);
        }
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        Ok(())
    }

    pub fn upgrade(env: Env, expected_wasm_hash: BytesN<32>) -> Result<(), FixtureError> {
        Self::admin(env.clone()).require_auth();
        if Self::locked(&env) {
            return Err(FixtureError::UpgradesLocked);
        }
        let pending = Self::pending_upgrade(env.clone()).ok_or(FixtureError::NoPendingUpgrade)?;
        if pending.wasm_hash != expected_wasm_hash {
            return Err(FixtureError::UpgradeHashMismatch);
        }
        let now = env.ledger().timestamp();
        if now < pending.eta {
            return Err(FixtureError::UpgradeTooEarly);
        }
        if now > pending.expires_at {
            return Err(FixtureError::UpgradeExpired);
        }
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(pending.wasm_hash));
        Ok(())
    }

    pub fn lock_upgrades(env: Env) -> Result<(), FixtureError> {
        Self::admin(env.clone()).require_auth();
        if Self::locked(&env) {
            return Err(FixtureError::UpgradesLocked);
        }
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.storage()
            .instance()
            .set(&DataKey::UpgradesLocked, &true);
        Ok(())
    }
}

impl UpgradeFixture {
    fn locked(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::UpgradesLocked)
            .unwrap_or(false)
    }
}
