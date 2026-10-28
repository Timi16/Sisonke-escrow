//! Pause (inflows only) and the two-step admin handover.

use soroban_sdk::{testutils::Address as _, Address, IntoVal, Val, Vec};

use super::{assert_auth_abort, v2, Setup, AMOUNT, DEADLINE};
use crate::{Error, PartyRole, Status};

fn no_args(s: &Setup) -> Vec<Val> {
    Vec::new(&s.env)
}

/// I15: pause blocks `create`, `create_and_fund` and `fund`, nothing else.
#[test]
fn pause_blocks_create_create_and_fund_and_fund() {
    let s = Setup::new();
    let id = s.create();
    s.client.set_paused(&true);
    assert!(s.client.is_paused());
    assert!(s.client.info().paused);

    let t = s.terms();
    assert_eq!(s.try_create(&t), Err(Ok(Error::Paused)));
    assert_eq!(s.try_create_and_fund(&t), Err(Ok(Error::Paused)));
    assert_eq!(s.client.try_fund(&id), Err(Ok(Error::Paused)));
    assert_eq!(s.client.escrow_count(), 1);
    assert_eq!(s.status(id), Status::Created);
    assert_eq!(s.balance(&s.contract), 0);
}

/// Every way out, and every keeper call, works while paused.
#[test]
fn pause_never_blocks_exits() {
    let s = Setup::new();
    let to_release = s.funded();
    let to_refund = s.funded();
    let to_dispute = s.funded();
    let to_resolve = s.disputed();
    let to_reclaim = s.create_and_fund_with(&super::Terms {
        deadline: super::START + 10,
        ..s.terms()
    });
    let to_cancel = s.create();
    s.client.set_paused(&true);

    s.client.release(&to_release);
    s.client.refund(&to_refund);
    s.client.dispute(&to_dispute, &s.payer);
    s.client.resolve(&to_resolve, &1);
    s.client.cancel(&to_cancel);
    s.client.extend_escrow_ttl(&to_release);
    s.client.extend_index_ttl(&s.payer, &PartyRole::Payer, &0);
    s.set_time(super::START + 10);
    s.client.reclaim(&to_reclaim);

    assert_eq!(s.status(to_release), Status::Released);
    assert_eq!(s.status(to_refund), Status::Refunded);
    assert_eq!(s.status(to_dispute), Status::Disputed);
    assert_eq!(s.status(to_resolve), Status::Split);
    assert_eq!(s.status(to_cancel), Status::Cancelled);
    assert_eq!(s.status(to_reclaim), Status::Refunded);
    // The concessions out of a dispute too.
    s.client.release(&to_dispute);
    assert_eq!(s.status(to_dispute), Status::Released);
    assert!(s.client.is_paused());
    assert_eq!(s.client.total_locked(), 0);
}

#[test]
fn unpause_restores_inflows() {
    let s = Setup::new();
    let id = s.create();
    s.client.set_paused(&true);
    // Idempotent: pausing twice is fine.
    s.client.set_paused(&true);
    assert_eq!(s.client.try_fund(&id), Err(Ok(Error::Paused)));
    s.client.set_paused(&false);
    assert!(!s.client.is_paused());
    s.client.fund(&id);
    let b = s.funded();
    assert_eq!(s.client.total_locked(), 2 * AMOUNT);
    assert_eq!(s.status(b), Status::Funded);
}

/// Like `Ownable2Step`: the role only moves when the proposed address
/// accepts.
#[test]
fn admin_handover_is_two_step() {
    let s = Setup::new();
    let next = Address::generate(&s.env);
    assert_eq!(s.client.pending_admin(), None);
    assert_eq!(s.client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));

    let args = (next.clone(),).into_val(&s.env);
    s.as_signer(&s.admin, "propose_admin", args, || {
        s.client.propose_admin(&next)
    });
    assert_eq!(s.client.pending_admin(), Some(next.clone()));
    assert_eq!(s.client.admin(), s.admin, "nothing changes until accepted");

    // Proposing again replaces the pending admin.
    let other = Address::generate(&s.env);
    s.client.propose_admin(&other);
    assert_eq!(s.client.pending_admin(), Some(other.clone()));
    assert_auth_abort(s.as_signer(&next, "accept_admin", no_args(&s), || {
        s.client.try_accept_admin()
    }));
    s.client.propose_admin(&next);

    s.as_signer(&next, "accept_admin", no_args(&s), || {
        s.client.accept_admin()
    });
    assert_eq!(s.client.admin(), next);
    assert_eq!(s.client.pending_admin(), None);
    assert_eq!(s.client.info().admin, next);
}

#[test]
fn cancel_admin_proposal_clears_pending() {
    let s = Setup::new();
    assert_eq!(
        s.client.try_cancel_admin_proposal(),
        Err(Ok(Error::NoPendingAdmin))
    );
    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    s.as_signer(&s.admin, "cancel_admin_proposal", no_args(&s), || {
        s.client.cancel_admin_proposal()
    });
    assert_eq!(s.client.pending_admin(), None);
    assert_eq!(s.client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
    assert_eq!(s.client.admin(), s.admin);
}

#[test]
fn old_admin_loses_every_power() {
    let s = Setup::new();
    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    s.client.accept_admin();
    let old = &s.admin;
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);

    assert_auth_abort(
        s.as_signer(old, "set_paused", (true,).into_val(&s.env), || {
            s.client.try_set_paused(&true)
        }),
    );
    let args = (old.clone(),).into_val(&s.env);
    assert_auth_abort(s.as_signer(old, "propose_admin", args, || {
        s.client.try_propose_admin(old)
    }));
    let args = (hash.clone(),).into_val(&s.env);
    assert_auth_abort(s.as_signer(old, "upgrade", args, || s.client.try_upgrade(&hash)));
    assert_auth_abort(s.as_signer(old, "lock_upgrades", no_args(&s), || {
        s.client.try_lock_upgrades()
    }));
    s.client.propose_admin(&s.stranger);
    assert_auth_abort(s.as_signer(old, "cancel_admin_proposal", no_args(&s), || {
        s.client.try_cancel_admin_proposal()
    }));
    assert!(!s.client.is_paused());
    assert!(s.client.upgrades_enabled());

    // The new admin has them all.
    s.as_signer(&next, "set_paused", (true,).into_val(&s.env), || {
        s.client.set_paused(&true)
    });
    assert!(s.client.is_paused());
}

/// I8: every admin function, fully authorized, leaves balances and escrows
/// exactly as they were.
#[test]
fn admin_functions_do_not_move_funds() {
    let s = Setup::new();
    let (a, b, c) = (s.create(), s.funded(), s.disputed());
    let before = s.snapshot();

    s.client.set_paused(&true);
    s.client.set_paused(&false);
    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    s.client.cancel_admin_proposal();
    s.client.propose_admin(&next);
    s.client.accept_admin();
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::NothingToMigrate)));
    s.client.lock_upgrades();
    s.set_time(DEADLINE + 1);

    let after = s.snapshot();
    assert_eq!(after.balances, before.balances);
    assert_eq!(after.escrows, before.escrows);
    assert_eq!(after.total_locked, before.total_locked);
    assert_eq!(after.info.admin, next, "only the admin keys changed");
    assert!(after.info.upgrades_locked);
    for id in [a, b, c] {
        assert_eq!(s.escrow(id), before.escrows[id as usize - 1]);
    }
}
