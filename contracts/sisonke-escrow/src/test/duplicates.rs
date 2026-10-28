//! Duplicate execution and finality: a closed escrow refuses everything,
//! with `InvalidStatus`, and changes nothing.

use super::{Act, Setup, AMOUNT};
use crate::{Error, Status};

#[test]
fn double_fund_fails() {
    let s = Setup::new();
    let id = s.create();
    s.client.fund(&id);
    assert_eq!(s.client.try_fund(&id), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.balance(&s.contract), AMOUNT);
    assert_eq!(s.client.total_locked(), AMOUNT);
}

#[test]
fn double_release_fails() {
    let s = Setup::new();
    let id = s.funded();
    s.client.release(&id);
    assert_eq!(s.client.try_release(&id), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

#[test]
fn double_refund_fails() {
    let s = Setup::new();
    let id = s.funded();
    s.client.refund(&id);
    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::InvalidStatus)));
}

#[test]
fn release_after_refund_fails() {
    let s = Setup::new();
    let id = s.funded();
    s.client.refund(&id);
    assert_eq!(s.client.try_release(&id), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.balance(&s.recipient), 0);
}

#[test]
fn refund_after_release_fails() {
    let s = Setup::new();
    let id = s.funded();
    s.client.release(&id);
    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

#[test]
fn double_reclaim_fails() {
    let s = Setup::new();
    let id = s.funded();
    s.set_time(super::DEADLINE);
    s.client.reclaim(&id);
    assert_eq!(s.client.try_reclaim(&id), Err(Ok(Error::InvalidStatus)));
}

#[test]
fn double_resolve_fails() {
    let s = Setup::new();
    let id = s.disputed();
    s.client.resolve(&id, &1);
    assert_eq!(s.client.try_resolve(&id, &1), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.balance(&s.recipient), 1);
}

#[test]
fn double_cancel_fails() {
    let s = Setup::new();
    let id = s.create();
    s.client.cancel(&id);
    assert_eq!(s.client.try_cancel(&id), Err(Ok(Error::InvalidStatus)));
}

#[test]
fn dispute_twice_fails() {
    let s = Setup::new();
    let id = s.disputed();
    assert_eq!(
        s.client.try_dispute(&id, &s.payer),
        Err(Ok(Error::InvalidStatus))
    );
    let e = s.escrow(id);
    assert_eq!(e.disputed_by, Some(s.recipient.clone()));
}

/// I4: 4 final statuses × every escrow write → 101, nothing changes.
#[test]
fn terminal_statuses_reject_every_action() {
    let s = Setup::new();
    let released = s.funded();
    s.client.release(&released);
    let refunded = s.funded();
    s.client.refund(&refunded);
    let split = s.disputed();
    s.client.resolve(&split, &(AMOUNT / 2));
    let cancelled = s.create();
    s.client.cancel(&cancelled);

    let acts = [
        Act::Fund,
        Act::Cancel,
        Act::Release,
        Act::Refund,
        Act::Reclaim,
        Act::Dispute(s.payer.clone()),
        Act::Dispute(s.recipient.clone()),
        Act::Resolve(1),
    ];
    let before = s.snapshot();
    for (id, status) in [
        (released, Status::Released),
        (refunded, Status::Refunded),
        (split, Status::Split),
        (cancelled, Status::Cancelled),
    ] {
        assert_eq!(s.status(id), status);
        for act in &acts {
            assert_eq!(
                s.try_act(act, id),
                Err(Ok(Error::InvalidStatus)),
                "{act:?} on {status:?}"
            );
            assert!(s.events().events().is_empty());
        }
    }
    // Also after the deadline, where reclaim's time check would pass.
    s.set_time(super::DEADLINE + 1);
    for id in [released, refunded, split, cancelled] {
        assert_eq!(s.client.try_reclaim(&id), Err(Ok(Error::InvalidStatus)));
    }
    assert_eq!(s.snapshot(), before);
}

#[test]
fn rejected_duplicate_changes_nothing() {
    let s = Setup::new();
    let id = s.funded();
    s.client.release(&id);
    let before = s.snapshot();

    assert_eq!(s.client.try_release(&id), Err(Ok(Error::InvalidStatus)));
    assert!(s.events().events().is_empty(), "no new events");
    assert_eq!(s.snapshot(), before);
}
