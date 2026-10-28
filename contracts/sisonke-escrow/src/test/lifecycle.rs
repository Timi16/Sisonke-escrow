//! Happy paths and the time boundaries around the deadline.

use soroban_sdk::testutils::Ledger as _;

use super::{Setup, AMOUNT, DEADLINE, PAYER_START, SEQUENCE, START};
use crate::{Error, Status};

#[test]
fn create_then_fund_then_release_pays_recipient() {
    let s = Setup::new();
    let id = s.create();
    assert_eq!(id, 1);
    assert_eq!(s.status(id), Status::Created);
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.client.total_locked(), 0);

    s.set_time(START + 60);
    s.client.fund(&id);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Funded);
    assert_eq!(e.funded_at, START + 60);
    assert_eq!(s.balance(&s.payer), PAYER_START - AMOUNT);
    assert_eq!(s.balance(&s.contract), AMOUNT);
    assert_eq!(s.client.total_locked(), AMOUNT);

    s.set_time(START + 120);
    s.client.release(&id);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Released);
    assert_eq!(e.paid_to_recipient, AMOUNT);
    assert_eq!(e.paid_to_payer, 0);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.balance(&s.payer), PAYER_START - AMOUNT);
    assert_eq!(s.client.total_locked(), 0);
}

#[test]
fn create_and_fund_then_release() {
    let s = Setup::new();
    let id = s.funded();
    assert_eq!(s.status(id), Status::Funded);
    assert_eq!(s.balance(&s.contract), AMOUNT);
    assert_eq!(s.client.total_locked(), AMOUNT);

    s.client.release(&id);
    assert_eq!(s.status(id), Status::Released);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
    assert_eq!(s.balance(&s.contract), 0);
}

#[test]
fn recipient_refund_returns_funds_to_payer() {
    let s = Setup::new();
    let id = s.funded();
    s.client.refund(&id);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Refunded);
    assert_eq!(e.paid_to_payer, AMOUNT);
    assert_eq!(e.paid_to_recipient, 0);
    assert_eq!(e.closed_by, Some(s.recipient.clone()));
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.balance(&s.recipient), 0);
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.client.total_locked(), 0);
}

#[test]
fn payer_reclaims_at_deadline() {
    let s = Setup::new();
    let id = s.funded();
    s.set_time(DEADLINE);
    s.client.reclaim(&id);
    let e = s.escrow(id);
    // A reclaim is recorded as Refunded, closed by the payer.
    assert_eq!(e.status, Status::Refunded);
    assert_eq!(e.closed_by, Some(s.payer.clone()));
    assert_eq!(e.closed_at, DEADLINE);
    assert_eq!(e.paid_to_payer, AMOUNT);
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.balance(&s.contract), 0);
}

#[test]
fn payer_cancels_unfunded_escrow() {
    let s = Setup::new();
    let id = s.create();
    s.client.cancel(&id);
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Cancelled);
    assert_eq!(e.closed_by, Some(s.payer.clone()));
    assert_eq!((e.paid_to_payer, e.paid_to_recipient), (0, 0));
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.client.total_locked(), 0);
}

#[test]
fn cancel_after_deadline_is_allowed() {
    let s = Setup::new();
    let id = s.create();
    s.set_time(DEADLINE + 30 * 86_400);
    s.client.cancel(&id);
    assert_eq!(s.status(id), Status::Cancelled);
}

#[test]
fn release_and_refund_allowed_after_deadline() {
    let s = Setup::new();
    let a = s.funded();
    let b = s.funded();
    s.set_time(DEADLINE + 1);
    s.client.release(&a);
    s.client.refund(&b);
    assert_eq!(s.status(a), Status::Released);
    assert_eq!(s.status(b), Status::Refunded);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
    assert_eq!(s.balance(&s.payer), PAYER_START - AMOUNT);
}

/// No cron job: an expired escrow keeps its funds locked and its status
/// until someone acts. Reads report that the deadline passed.
#[test]
fn funded_escrow_stays_funded_past_deadline_until_acted_on() {
    let s = Setup::new();
    let id = s.funded();
    assert!(!s.client.get_escrow(&id).deadline_passed);
    s.set_time(DEADLINE + 100 * 86_400);
    let view = s.client.get_escrow(&id);
    assert_eq!(view.escrow.status, Status::Funded);
    assert!(view.deadline_passed);
    assert_eq!(s.client.total_locked(), AMOUNT);
    assert_eq!(s.balance(&s.contract), AMOUNT);
}

#[test]
fn fund_at_or_after_deadline_fails() {
    let s = Setup::new();
    let id = s.create();
    s.set_time(DEADLINE);
    assert_eq!(s.client.try_fund(&id), Err(Ok(Error::DeadlinePassed)));
    s.set_time(DEADLINE + 1);
    assert_eq!(s.client.try_fund(&id), Err(Ok(Error::DeadlinePassed)));
    assert_eq!(s.status(id), Status::Created);
    assert_eq!(s.balance(&s.payer), PAYER_START);
}

#[test]
fn reclaim_before_deadline_fails() {
    let s = Setup::new();
    let id = s.funded();
    s.set_time(DEADLINE - 1);
    assert_eq!(
        s.client.try_reclaim(&id),
        Err(Ok(Error::DeadlineNotReached))
    );
    assert_eq!(s.status(id), Status::Funded);
}

/// I10: for every `now`, exactly one of {fund/dispute allowed by time,
/// reclaim allowed by time} holds. The deadline second belongs to reclaim.
#[test]
fn deadline_second_is_partitioned() {
    let s = Setup::new();
    let (to_fund, to_dispute, to_reclaim) = (s.create(), s.funded(), s.funded());

    s.set_time(DEADLINE - 1);
    assert_eq!(
        s.client.try_reclaim(&to_reclaim),
        Err(Ok(Error::DeadlineNotReached))
    );
    let (late_fund, late_dispute) = (s.create(), s.funded());
    s.client.fund(&to_fund);
    s.client.dispute(&to_dispute, &s.payer);

    s.set_time(DEADLINE);
    assert_eq!(
        s.client.try_fund(&late_fund),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(
        s.client.try_dispute(&late_dispute, &s.recipient),
        Err(Ok(Error::DeadlinePassed))
    );
    s.client.reclaim(&to_reclaim);

    assert_eq!(s.status(to_fund), Status::Funded);
    assert_eq!(s.status(to_dispute), Status::Disputed);
    assert_eq!(s.status(to_reclaim), Status::Refunded);
    assert_eq!(s.status(late_fund), Status::Created);
    assert_eq!(s.status(late_dispute), Status::Funded);
}

#[test]
fn escrow_records_timestamps_ledgers_and_closer() {
    let s = Setup::new();
    let t = s.terms();
    let id = s.create_with(&t);
    let e = s.escrow(id);
    assert_eq!(e.id, id);
    assert_eq!(e.payer, t.payer);
    assert_eq!(e.recipient, t.recipient);
    assert_eq!(e.arbiter, t.arbiter);
    assert_eq!(e.token, s.usdc.address);
    assert_eq!(e.amount, t.amount);
    assert_eq!(e.deadline, t.deadline);
    assert_eq!(e.title, t.title);
    assert_eq!(e.terms_hash, t.terms_hash);
    assert_eq!((e.created_at, e.created_ledger), (START, SEQUENCE));
    assert_eq!(e.updated_ledger, SEQUENCE);
    assert_eq!((e.funded_at, e.disputed_at, e.closed_at), (0, 0, 0));
    assert_eq!((e.disputed_by, e.closed_by), (None, None));

    s.env.ledger().with_mut(|l| {
        l.timestamp = START + 10;
        l.sequence_number = SEQUENCE + 2;
    });
    s.client.fund(&id);
    let e = s.escrow(id);
    assert_eq!((e.funded_at, e.updated_ledger), (START + 10, SEQUENCE + 2));

    s.env.ledger().with_mut(|l| {
        l.timestamp = START + 20;
        l.sequence_number = SEQUENCE + 4;
    });
    s.client.dispute(&id, &s.recipient);
    let e = s.escrow(id);
    assert_eq!(e.disputed_at, START + 20);
    assert_eq!(e.disputed_by, Some(s.recipient.clone()));
    assert_eq!(e.updated_ledger, SEQUENCE + 4);

    s.env.ledger().with_mut(|l| {
        l.timestamp = START + 30;
        l.sequence_number = SEQUENCE + 6;
    });
    s.client.resolve(&id, &(AMOUNT / 4));
    let e = s.escrow(id);
    assert_eq!(e.status, Status::Split);
    assert_eq!(e.closed_at, START + 30);
    assert_eq!(e.closed_by, Some(s.arbiter.clone()));
    assert_eq!(e.updated_ledger, SEQUENCE + 6);
    assert_eq!(e.paid_to_recipient, AMOUNT / 4);
    assert_eq!(e.paid_to_payer, AMOUNT - AMOUNT / 4);
    // Terms and creation fields never change (I9).
    assert_eq!((e.created_at, e.created_ledger), (START, SEQUENCE));
    assert_eq!(e.title, t.title);
    assert_eq!(e.deadline, t.deadline);
}
