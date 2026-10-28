//! `TotalLocked` and the conservation law (I1), isolation between escrows,
//! donations, atomicity of failed funding, and the transfer-delta check.

extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, Address, Env, MuxedAddress,
};

use super::{new_env, Setup, Terms, AMOUNT, DEADLINE, PAYER_START};
use crate::{Error, PartyRole, Status};

/// I1: `total_locked` is the sum over Funded and Disputed escrows, and the
/// contract holds at least that much.
fn assert_conserved(s: &Setup) {
    let snap = s.snapshot();
    let locked: i128 = snap
        .escrows
        .iter()
        .filter(|e| matches!(e.status, Status::Funded | Status::Disputed))
        .map(|e| e.amount)
        .sum();
    assert_eq!(snap.total_locked, locked);
    assert!(s.balance(&s.contract) >= locked);
}

#[test]
fn total_locked_tracks_funded_and_disputed() {
    let s = Setup::new();
    let a = s.create();
    assert_eq!(s.client.total_locked(), 0);
    s.client.fund(&a);
    assert_eq!(s.client.total_locked(), AMOUNT);
    let b = s.create_and_fund_with(&Terms {
        amount: 7,
        ..s.terms()
    });
    assert_eq!(s.client.total_locked(), AMOUNT + 7);
    s.client.dispute(&b, &s.payer);
    assert_eq!(s.client.total_locked(), AMOUNT + 7, "disputed stays locked");
    assert_conserved(&s);

    let c = s.create();
    s.client.cancel(&c);
    assert_eq!(s.client.total_locked(), AMOUNT + 7, "cancel moves nothing");
    s.client.resolve(&b, &3);
    assert_eq!(s.client.total_locked(), AMOUNT);
    s.client.release(&a);
    assert_eq!(s.client.total_locked(), 0);
    assert_eq!(s.balance(&s.contract), 0);
    assert_conserved(&s);
    assert_eq!(s.client.info().total_locked, 0);
}

/// Three escrows; closing one moves exactly its own amount.
#[test]
fn escrows_are_isolated() {
    let s = Setup::new();
    let amounts = [AMOUNT, 3, AMOUNT / 7];
    let ids: std::vec::Vec<u64> = amounts
        .iter()
        .map(|&amount| {
            s.create_and_fund_with(&Terms {
                amount,
                ..s.terms()
            })
        })
        .collect();
    let total: i128 = amounts.iter().sum();
    assert_eq!(s.balance(&s.contract), total);

    s.client.release(&ids[1]);
    assert_eq!(s.balance(&s.contract), total - 3);
    assert_eq!(s.balance(&s.recipient), 3);
    assert_eq!(s.status(ids[0]), Status::Funded);
    assert_eq!(s.status(ids[2]), Status::Funded);

    s.client.refund(&ids[0]);
    assert_eq!(s.balance(&s.contract), AMOUNT / 7);
    assert_eq!(s.client.total_locked(), AMOUNT / 7);
    assert_eq!(s.status(ids[2]), Status::Funded);
    assert_conserved(&s);
}

/// Tokens sent straight to the contract are never paid out to anyone: every
/// escrow still settles exactly its own amount, and I1 holds as `>=`.
#[test]
fn donation_does_not_break_settlement() {
    let s = Setup::new();
    let a = s.funded();
    let b = s.disputed();
    let donation = 12_345;
    s.usdc_admin.mint(&s.contract, &donation);
    assert_eq!(s.balance(&s.contract), 2 * AMOUNT + donation);
    assert_conserved(&s);

    // Funding still checks the delta, not the absolute balance.
    let c = s.create();
    s.client.fund(&c);

    s.client.release(&a);
    s.client.resolve(&b, &1);
    s.set_time(DEADLINE);
    s.client.reclaim(&c);
    assert_eq!(s.balance(&s.recipient), AMOUNT + 1);
    assert_eq!(s.balance(&s.payer), PAYER_START - AMOUNT - 1);
    assert_eq!(s.client.total_locked(), 0);
    assert_eq!(s.balance(&s.contract), donation);
    assert_conserved(&s);
}

/// A payer without enough USDC: the token refuses, and the whole call
/// reverts with it.
#[test]
fn underfunded_fund_leaves_no_trace() {
    let s = Setup::new();
    let poor = Address::generate(&s.env);
    s.usdc_admin.mint(&poor, &(AMOUNT - 1));
    let id = s.create_with(&Terms {
        payer: poor.clone(),
        ..s.terms()
    });
    let before = s.snapshot();

    let result = s.client.try_fund(&id);
    assert!(
        matches!(result, Err(Err(_))),
        "the token's own error, not ours: {result:?}"
    );
    assert!(s.events().events().is_empty());
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.balance(&poor), AMOUNT - 1);
    assert_eq!(s.status(id), Status::Created);
}

#[test]
fn underfunded_create_and_fund_leaves_no_trace() {
    let s = Setup::new();
    let poor = Address::generate(&s.env);
    s.usdc_admin.mint(&poor, &(AMOUNT - 1));
    let t = Terms {
        payer: poor.clone(),
        ..s.terms()
    };
    let before = s.snapshot();

    let result = s.try_create_and_fund(&t);
    assert!(matches!(result, Err(Err(_))), "{result:?}");
    assert!(s.events().events().is_empty());
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.client.escrow_count(), 0, "the id was not consumed");
    assert_eq!(s.client.party_escrow_count(&poor, &PartyRole::Payer), 0);
    assert_eq!(
        s.client
            .party_escrow_count(&s.recipient, &PartyRole::Recipient),
        0
    );
    assert_eq!(s.balance(&poor), AMOUNT - 1);
}

// ------------------------------------------------- fee-on-transfer token

#[contracttype]
enum SkimKey {
    Balance(Address),
}

/// Test-only token that keeps 1 unit of every transfer, like a
/// fee-on-transfer or deflationary token would.
#[contract]
pub struct SkimToken;

#[contractimpl]
impl SkimToken {
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&SkimKey::Balance(id))
            .unwrap_or(0)
    }

    /// Same signature as the SAC's `mint`, so `StellarAssetClient` can call it.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&SkimKey::Balance(to), &(balance + amount));
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        let from_balance = Self::balance(env.clone(), from.clone());
        let to_balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&SkimKey::Balance(from), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&SkimKey::Balance(to), &(to_balance + amount - 1));
    }
}

#[test]
fn fee_on_transfer_token_is_rejected() {
    let env = new_env();
    let skim = env.register(SkimToken, ());
    let s = Setup::new_in(env, None, Some(skim.clone()));
    assert_eq!(s.client.token(), skim);

    let id = s.create();
    let before = s.snapshot();
    assert_eq!(s.client.try_fund(&id), Err(Ok(Error::TransferMismatch)));
    assert!(s.events().events().is_empty());
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.status(id), Status::Created);

    let t = s.terms();
    assert_eq!(s.try_create_and_fund(&t), Err(Ok(Error::TransferMismatch)));
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.client.total_locked(), 0);
}

/// I3: whatever happens, the arbiter, the admin and strangers never receive
/// a single unit.
#[test]
fn funds_only_reach_payer_or_recipient() {
    let s = Setup::new();
    let outsiders = |s: &Setup| {
        [&s.arbiter, &s.admin, &s.stranger]
            .iter()
            .map(|a| s.balance(a))
            .collect::<std::vec::Vec<_>>()
    };
    let zero = std::vec![0, 0, 0];

    let a = s.funded();
    s.client.release(&a);
    assert_eq!(outsiders(&s), zero);
    let b = s.funded();
    s.client.refund(&b);
    assert_eq!(outsiders(&s), zero);
    for split in [0, 1, AMOUNT / 2, AMOUNT - 1, AMOUNT] {
        let id = s.disputed();
        s.client.resolve(&id, &split);
        assert_eq!(outsiders(&s), zero);
    }
    let c = s.disputed();
    s.client.release(&c);
    let d = s.disputed();
    s.client.refund(&d);
    let e = s.create();
    s.client.cancel(&e);
    let f = s.funded();
    s.set_time(DEADLINE);
    s.client.reclaim(&f);
    assert_eq!(outsiders(&s), zero);

    // Everything that left the contract went to the payer or the recipient.
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.balance(&s.payer) + s.balance(&s.recipient), PAYER_START);
}
