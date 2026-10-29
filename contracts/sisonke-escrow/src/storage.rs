//! Typed access to contract storage, the TTL policy and the paged party index.
//!
//! Reads never write or extend anything, so simulating a read has no side
//! effects. Every persistent write extends the TTL of the entry it touched.

use soroban_sdk::{Address, Env, Vec};

use crate::errors::Error;
use crate::types::{DataKey, Escrow, PartyRole, PendingUpgrade};

/// ~5 second ledgers.
pub const DAY_IN_LEDGERS: u32 = 17_280;

/// Instance and persistent entries are extended to 120 days, below Testnet's
/// `max_entry_ttl` (3,110,400 ledgers, ~180 days)...
pub const TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;
/// ...but only once fewer than 60 days remain, so busy entries don't pay
/// rent on every call.
pub const TTL_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;

/// Ids per `PartyPage`. Keeps every index write O(1) and bounded in size.
pub const PAGE_SIZE: u32 = 50;

/// Extends the instance (admin, counters, flags) and the contract code.
/// First line of every public write.
pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn set_persistent<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
    value: &V,
) {
    env.storage().persistent().set(key, value);
    extend_persistent(env, key);
}

fn extend_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

// ---------------------------------------------------------------- admin

pub fn admin(env: &Env) -> Address {
    // Set in the constructor, so it is always present.
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}

pub fn set_pending_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::PendingAdmin, addr);
}

pub fn clear_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
}

// ------------------------------------------------------------- settings

pub fn token(env: &Env) -> Address {
    // Set in the constructor, so it is always present.
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn upgrades_locked(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::UpgradesLocked)
        .unwrap_or(false)
}

pub fn set_upgrades_locked(env: &Env, locked: bool) {
    env.storage()
        .instance()
        .set(&DataKey::UpgradesLocked, &locked);
}

/// Set by the constructor. If it is ever missing (an instance built by
/// older code), the strictest delay applies rather than a trap.
pub fn upgrade_delay(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::UpgradeDelay)
        .unwrap_or(crate::MAX_UPGRADE_DELAY)
}

pub fn set_upgrade_delay(env: &Env, delay: u64) {
    env.storage().instance().set(&DataKey::UpgradeDelay, &delay);
}

pub fn pending_upgrade(env: &Env) -> Option<PendingUpgrade> {
    env.storage().instance().get(&DataKey::PendingUpgrade)
}

pub fn set_pending_upgrade(env: &Env, pending: &PendingUpgrade) {
    env.storage()
        .instance()
        .set(&DataKey::PendingUpgrade, pending);
}

pub fn clear_pending_upgrade(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingUpgrade);
}

pub fn storage_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::StorageVersion)
        .unwrap_or(0)
}

pub fn set_storage_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::StorageVersion, &version);
}

// ------------------------------------------------------------- counters

pub fn peek_next_id(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::NextId).unwrap_or(1)
}

pub fn set_next_id(env: &Env, next: u64) {
    env.storage().instance().set(&DataKey::NextId, &next);
}

/// Hands out the next escrow id. Ids start at 1, so 0 is never a valid id.
pub fn take_next_id(env: &Env) -> Result<u64, Error> {
    let id = peek_next_id(env);
    set_next_id(env, id.checked_add(1).ok_or(Error::Overflow)?);
    Ok(id)
}

pub fn total_locked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalLocked)
        .unwrap_or(0)
}

pub fn set_total_locked(env: &Env, total: i128) {
    env.storage().instance().set(&DataKey::TotalLocked, &total);
}

pub fn add_locked(env: &Env, amount: i128) -> Result<(), Error> {
    let total = total_locked(env)
        .checked_add(amount)
        .ok_or(Error::Overflow)?;
    set_total_locked(env, total);
    Ok(())
}

pub fn sub_locked(env: &Env, amount: i128) -> Result<(), Error> {
    let total = total_locked(env)
        .checked_sub(amount)
        .ok_or(Error::Overflow)?;
    set_total_locked(env, total);
    Ok(())
}

// -------------------------------------------------------------- escrows

pub fn try_load(env: &Env, id: u64) -> Option<Escrow> {
    env.storage().persistent().get(&DataKey::Escrow(id))
}

pub fn load(env: &Env, id: u64) -> Result<Escrow, Error> {
    try_load(env, id).ok_or(Error::NotFound)
}

pub fn save(env: &Env, escrow: &Escrow) {
    set_persistent(env, &DataKey::Escrow(escrow.id), escrow);
}

/// Extends one escrow's record. `false` if there is no such escrow.
pub fn extend_escrow(env: &Env, id: u64) -> bool {
    let key = DataKey::Escrow(id);
    if !env.storage().persistent().has(&key) {
        return false;
    }
    extend_persistent(env, &key);
    true
}

// ----------------------------------------------------------- party index

pub fn party_count(env: &Env, party: &Address, role: PartyRole) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PartyCount(party.clone(), role))
        .unwrap_or(0)
}

pub fn party_page(env: &Env, party: &Address, role: PartyRole, page: u32) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::PartyPage(party.clone(), role, page))
        .unwrap_or_else(|| Vec::new(env))
}

/// Appends `id` to the party's last page, starting a new page every
/// `PAGE_SIZE` ids. Touches exactly two entries, whatever the party's history.
pub fn index_push(env: &Env, party: &Address, role: PartyRole, id: u64) -> Result<(), Error> {
    let count = party_count(env, party, role);
    let page = count / PAGE_SIZE;
    let mut ids = party_page(env, party, role, page);
    ids.push_back(id);
    set_persistent(env, &DataKey::PartyPage(party.clone(), role, page), &ids);
    let next = count.checked_add(1).ok_or(Error::Overflow)?;
    set_persistent(env, &DataKey::PartyCount(party.clone(), role), &next);
    Ok(())
}

/// Extends a party's count entry and one of its pages; missing entries are
/// skipped.
pub fn extend_index(env: &Env, party: &Address, role: PartyRole, page: u32) {
    for key in [
        DataKey::PartyCount(party.clone(), role),
        DataKey::PartyPage(party.clone(), role, page),
    ] {
        if env.storage().persistent().has(&key) {
            extend_persistent(env, &key);
        }
    }
}
