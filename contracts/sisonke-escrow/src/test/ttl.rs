//! TTL policy (I19): writes extend what they touch to 120 days once fewer
//! than 60 remain; anyone can bump an escrow or index entry; archival never
//! loses funds.

use soroban_sdk::testutils::{
    storage::{Instance as _, Persistent as _},
    Address as _,
};
use soroban_sdk::Address;

use super::{Setup, Terms, AMOUNT, DAY, START};
use crate::{DataKey, PartyRole, Status, DAY_IN_LEDGERS, TTL_EXTEND_TO, TTL_THRESHOLD};

const D: u32 = DAY_IN_LEDGERS;

fn ttl(s: &Setup, key: &DataKey) -> u32 {
    s.env
        .as_contract(&s.contract, || s.env.storage().persistent().get_ttl(key))
}

fn instance_ttl(s: &Setup) -> u32 {
    s.env
        .as_contract(&s.contract, || s.env.storage().instance().get_ttl())
}

fn count_key(who: &Address, role: PartyRole) -> DataKey {
    DataKey::PartyCount(who.clone(), role)
}

fn page_key(who: &Address, role: PartyRole, page: u32) -> DataKey {
    DataKey::PartyPage(who.clone(), role, page)
}

#[test]
fn create_extends_escrow_index_and_instance() {
    let s = Setup::new();
    assert_eq!(TTL_EXTEND_TO, 120 * D);
    assert_eq!(TTL_THRESHOLD, 60 * D);
    // Funded, so the recipient's and arbiter's index entries exist too.
    let id = s.funded();
    assert_eq!(ttl(&s, &DataKey::Escrow(id)), 120 * D);
    for (who, role) in [
        (&s.payer, PartyRole::Payer),
        (&s.recipient, PartyRole::Recipient),
        (&s.arbiter, PartyRole::Arbiter),
    ] {
        assert_eq!(ttl(&s, &count_key(who, role)), 120 * D, "{role:?}");
        assert_eq!(ttl(&s, &page_key(who, role, 0)), 120 * D, "{role:?}");
    }
    assert_eq!(instance_ttl(&s), 120 * D);
}

#[test]
fn transition_tops_up_low_ttl() {
    let s = Setup::new();
    let id = s.create_with(&Terms {
        deadline: START + 100 * DAY,
        ..s.terms()
    });
    s.advance_days(70);
    assert_eq!(ttl(&s, &DataKey::Escrow(id)), 50 * D);
    assert_eq!(instance_ttl(&s), 50 * D);

    s.client.fund(&id);
    assert_eq!(ttl(&s, &DataKey::Escrow(id)), 120 * D);
    assert_eq!(instance_ttl(&s), 120 * D);

    // An admin write keeps the instance alive too.
    s.advance_days(70);
    s.client.set_paused(&false);
    assert_eq!(instance_ttl(&s), 120 * D);
}

/// Above the 60-day threshold nothing is extended, so busy entries don't
/// pay rent on every call.
#[test]
fn healthy_entries_not_extended() {
    let s = Setup::new();
    let id = s.create_with(&Terms {
        deadline: START + 30 * DAY,
        ..s.terms()
    });
    s.advance_days(10);
    s.client.fund(&id);
    assert_eq!(ttl(&s, &DataKey::Escrow(id)), 110 * D);
    assert_eq!(instance_ttl(&s), 110 * D);
}

#[test]
fn extend_escrow_ttl_is_permissionless_and_extends() {
    let s = Setup::new();
    let id = s.funded();
    s.advance_days(70);
    s.env.mock_auths(&[]);
    s.client.extend_escrow_ttl(&id);
    assert_eq!(ttl(&s, &DataKey::Escrow(id)), 120 * D);
    assert_eq!(instance_ttl(&s), 120 * D);
    assert_eq!(
        s.client.try_extend_escrow_ttl(&99),
        Err(Ok(crate::Error::NotFound))
    );
    s.env.mock_all_auths();
    // Nothing but the TTL changed.
    assert_eq!(s.status(id), Status::Funded);
}

#[test]
fn extend_index_ttl_is_permissionless() {
    let s = Setup::new();
    s.funded();
    s.advance_days(70);
    s.env.mock_auths(&[]);
    s.client.extend_index_ttl(&s.payer, &PartyRole::Payer, &0);
    // Missing entries are skipped, not an error.
    s.client
        .extend_index_ttl(&Address::generate(&s.env), &PartyRole::Arbiter, &3);
    s.env.mock_all_auths();
    assert_eq!(ttl(&s, &count_key(&s.payer, PartyRole::Payer)), 120 * D);
    assert_eq!(ttl(&s, &page_key(&s.payer, PartyRole::Payer, 0)), 120 * D);
    // Only the entries asked for.
    assert_eq!(
        ttl(&s, &count_key(&s.recipient, PartyRole::Recipient)),
        50 * D
    );
}

/// The longest escrow outlives one 120-day extension; a keeper bumping it
/// every 50 days keeps it live until it settles.
#[test]
fn long_escrow_survives_with_bumps() {
    let s = Setup::new();
    let id = s.create_and_fund_with(&Terms {
        deadline: START + 360 * DAY,
        ..s.terms()
    });
    for _ in 0..6 {
        s.advance_days(50);
        assert!(ttl(&s, &DataKey::Escrow(id)) >= 20 * D, "still live");
        s.client.extend_escrow_ttl(&id);
        assert!(ttl(&s, &DataKey::Escrow(id)) >= 60 * D);
    }
    s.client.release(&id);
    assert_eq!(s.status(id), Status::Released);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

/// Since Protocol 23 an invoke restores archived footprint entries
/// automatically, and the SDK emulates that: an escrow whose record (and
/// the instance) archived still settles, at the cost of a restore. Archival
/// is a cost/liveness concern, never a loss of funds.
#[test]
fn archived_escrow_still_settles() {
    let s = Setup::new();
    let id = s.funded();
    s.advance_days(130);
    s.client.release(&id);
    assert_eq!(s.status(id), Status::Released);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
    assert_eq!(ttl(&s, &DataKey::Escrow(id)), 120 * D);
}
