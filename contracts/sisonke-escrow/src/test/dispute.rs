//! Arbiter flows: who may open a dispute and when, what the arbiter may do,
//! and the concessions that stay open while disputed.

use soroban_sdk::testutils::Events as _;

use super::{Setup, AMOUNT, DEADLINE, PAYER_START};
use crate::{Error, Status};

#[test]
fn recipient_dispute_blocks_reclaim_after_deadline() {
    let s = Setup::new();
    let id = s.funded();
    s.set_time(DEADLINE - 1);
    s.client.dispute(&id, &s.recipient);
    s.set_time(DEADLINE + 1);
    assert_eq!(s.client.try_reclaim(&id), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.status(id), Status::Disputed);
    assert_eq!(s.balance(&s.contract), AMOUNT);
    assert_eq!(s.client.total_locked(), AMOUNT);
}

#[test]
fn payer_can_dispute() {
    let s = Setup::new();
    let id = s.funded();
    s.client.dispute(&id, &s.payer);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Disputed);
    assert_eq!(e.disputed_by, Some(s.payer.clone()));
    assert_eq!(e.disputed_at, super::START);
    // Disputing moves nothing.
    assert_eq!(s.balance(&s.contract), AMOUNT);
    assert_eq!(s.client.total_locked(), AMOUNT);
}

#[test]
fn dispute_without_arbiter_fails() {
    let s = Setup::new();
    let id = s.create_and_fund_with(&s.terms_no_arbiter());
    for by in [&s.payer, &s.recipient] {
        assert_eq!(s.client.try_dispute(&id, by), Err(Ok(Error::NoArbiter)));
    }
    // No arbiter wins over the deadline too.
    s.set_time(DEADLINE);
    assert_eq!(
        s.client.try_dispute(&id, &s.payer),
        Err(Ok(Error::NoArbiter))
    );
    assert_eq!(s.status(id), Status::Funded);
}

#[test]
fn dispute_at_or_after_deadline_fails() {
    let s = Setup::new();
    let id = s.funded();
    for now in [DEADLINE, DEADLINE + 1] {
        s.set_time(now);
        assert_eq!(
            s.client.try_dispute(&id, &s.recipient),
            Err(Ok(Error::DeadlinePassed))
        );
    }
    s.client.reclaim(&id);
    assert_eq!(s.status(id), Status::Refunded);
}

#[test]
fn dispute_on_created_fails() {
    let s = Setup::new();
    let id = s.create();
    assert_eq!(
        s.client.try_dispute(&id, &s.payer),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn arbiter_full_release_is_released() {
    let s = Setup::new();
    let id = s.disputed();
    s.client.resolve(&id, &AMOUNT);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Released);
    assert_eq!((e.paid_to_recipient, e.paid_to_payer), (AMOUNT, 0));
    assert_eq!(e.closed_by, Some(s.arbiter.clone()));
    assert_eq!(s.balance(&s.recipient), AMOUNT);
    assert_eq!(s.balance(&s.arbiter), 0);
    assert_eq!(s.client.total_locked(), 0);
}

#[test]
fn arbiter_full_refund_is_refunded() {
    let s = Setup::new();
    let id = s.disputed();
    s.client.resolve(&id, &0);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Refunded);
    assert_eq!((e.paid_to_recipient, e.paid_to_payer), (0, AMOUNT));
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.balance(&s.recipient), 0);
}

#[test]
fn arbiter_split_pays_both_exactly() {
    let s = Setup::new();
    let id = s.disputed();
    let to_recipient = 300_000_001;
    s.client.resolve(&id, &to_recipient);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Split);
    assert_eq!(e.paid_to_recipient, to_recipient);
    assert_eq!(e.paid_to_payer, AMOUNT - to_recipient);
    assert_eq!(s.balance(&s.recipient), to_recipient);
    assert_eq!(
        s.balance(&s.payer),
        PAYER_START - AMOUNT + (AMOUNT - to_recipient)
    );
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.balance(&s.arbiter), 0);
    assert_eq!(s.client.total_locked(), 0);
}

#[test]
fn resolve_out_of_range_fails() {
    let s = Setup::new();
    let id = s.disputed();
    for bad in [-1, AMOUNT + 1, i128::MIN, i128::MAX] {
        assert_eq!(
            s.client.try_resolve(&id, &bad),
            Err(Ok(Error::InvalidSplit)),
            "{bad}"
        );
    }
    assert_eq!(s.status(id), Status::Disputed);
}

/// A zero side gets no transfer at all, not a transfer of 0.
#[test]
fn resolve_zero_side_skips_transfer() {
    let s = Setup::new();
    let to_payer = s.disputed();
    s.client.resolve(&to_payer, &0);
    let usdc_events = s.env.events().all().filter_by_contract(&s.usdc.address);
    assert_eq!(usdc_events.events().len(), 1, "one transfer, to the payer");

    let to_recipient = s.disputed();
    s.client.resolve(&to_recipient, &AMOUNT);
    let usdc_events = s.env.events().all().filter_by_contract(&s.usdc.address);
    assert_eq!(
        usdc_events.events().len(),
        1,
        "one transfer, to the recipient"
    );

    let split = s.disputed();
    s.client.resolve(&split, &1);
    let usdc_events = s.env.events().all().filter_by_contract(&s.usdc.address);
    assert_eq!(usdc_events.events().len(), 2, "both sides paid");
}

#[test]
fn resolve_on_undisputed_escrow_fails() {
    let s = Setup::new();
    let created = s.create();
    let funded = s.funded();
    for id in [created, funded] {
        assert_eq!(s.client.try_resolve(&id, &0), Err(Ok(Error::InvalidStatus)));
    }
    let no_arbiter = s.create_and_fund_with(&s.terms_no_arbiter());
    assert_eq!(
        s.client.try_resolve(&no_arbiter, &0),
        Err(Ok(Error::NoArbiter))
    );
}

/// The arbiter has no power until a dispute is open, even after the deadline.
#[test]
fn arbiter_cannot_act_before_dispute() {
    let s = Setup::new();
    let id = s.funded();
    let before = s.snapshot();
    for (i, act) in [super::Act::Resolve(AMOUNT), super::Act::Resolve(0)]
        .iter()
        .enumerate()
    {
        assert_eq!(
            s.act_as(&s.arbiter, act, id),
            Err(Ok(Error::InvalidStatus)),
            "case {i}"
        );
    }
    s.set_time(DEADLINE + 1);
    assert_eq!(
        s.act_as(&s.arbiter, &super::Act::Resolve(AMOUNT), id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(s.snapshot().escrows, before.escrows);
    assert_eq!(s.snapshot().balances, before.balances);
}

#[test]
fn payer_concedes_release_during_dispute() {
    let s = Setup::new();
    let id = s.disputed();
    s.client.release(&id);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Released);
    assert_eq!(e.closed_by, Some(s.payer.clone()));
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

#[test]
fn recipient_concedes_refund_during_dispute() {
    let s = Setup::new();
    let id = s.funded();
    s.client.dispute(&id, &s.payer);
    s.set_time(DEADLINE + 1);
    s.client.refund(&id);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Refunded);
    assert_eq!(e.closed_by, Some(s.recipient.clone()));
    assert_eq!(s.balance(&s.payer), PAYER_START);
}

#[test]
fn resolve_after_concession_fails() {
    let s = Setup::new();
    let released = s.disputed();
    s.client.release(&released);
    let refunded = s.disputed();
    s.client.refund(&refunded);
    for id in [released, refunded] {
        assert_eq!(s.client.try_resolve(&id, &1), Err(Ok(Error::InvalidStatus)));
    }
}
