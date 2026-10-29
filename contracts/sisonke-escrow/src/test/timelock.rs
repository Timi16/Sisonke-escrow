//! The upgrade timelock: `propose_upgrade` → wait `upgrade_delay` →
//! `upgrade`. During the delay nothing changes for escrows, so anyone who
//! distrusts the proposed code can exit first.

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, BytesN, Event, IntoVal, Val, Vec};

use super::{
    assert_auth_abort, new_env, v2, Act, Setup, AMOUNT, DEADLINE, PAYER_START, START, UPGRADE_DELAY,
};
use crate::{
    events, Error, PendingUpgrade, SisonkeEscrow, Status, MAX_UPGRADE_DELAY, MIN_UPGRADE_DELAY,
    UPGRADE_WINDOW, VERSION,
};

fn no_args(s: &Setup) -> Vec<Val> {
    Vec::new(&s.env)
}

fn fixture_hash(s: &Setup) -> BytesN<32> {
    s.env.deployer().upload_contract_wasm(v2::WASM)
}

/// Deploys with `delay`; `Err` if the constructor refuses it.
fn deploy_with_delay(delay: u64) -> Result<(), ()> {
    std::panic::catch_unwind(|| {
        let env = new_env();
        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        env.register(SisonkeEscrow, (&admin, &token, delay));
    })
    .map_err(|_| ())
}

#[test]
fn constructor_bounds_the_upgrade_delay() {
    assert_eq!(MIN_UPGRADE_DELAY, 60);
    assert_eq!(MAX_UPGRADE_DELAY, 30 * 86_400);
    assert!(deploy_with_delay(MIN_UPGRADE_DELAY).is_ok());
    assert!(deploy_with_delay(MAX_UPGRADE_DELAY).is_ok());
    for bad in [0, MIN_UPGRADE_DELAY - 1, MAX_UPGRADE_DELAY + 1, u64::MAX] {
        assert!(deploy_with_delay(bad).is_err(), "delay {bad} accepted");
    }
    let s = Setup::new();
    assert_eq!(s.client.upgrade_delay(), UPGRADE_DELAY);
    assert_eq!(s.client.info().upgrade_delay, UPGRADE_DELAY);
}

#[test]
fn upgrade_is_refused_before_eta_and_allowed_at_eta() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::NoPendingUpgrade))
    );

    s.set_time(START + 5);
    s.client.propose_upgrade(&hash);
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(
        pending,
        PendingUpgrade {
            wasm_hash: hash.clone(),
            proposed_at: START + 5,
            eta: START + 5 + UPGRADE_DELAY,
            expires_at: START + 5 + UPGRADE_DELAY + UPGRADE_WINDOW,
        }
    );
    let info = s.client.info();
    assert_eq!(info.pending_upgrade_hash, Some(hash.clone()));
    assert_eq!(info.pending_upgrade_eta, Some(pending.eta));

    for now in [START + 5, pending.eta - 1] {
        s.set_time(now);
        assert_eq!(
            s.client.try_upgrade(&s.pending_hash()),
            Err(Ok(Error::UpgradeTooEarly))
        );
    }
    assert_eq!(s.client.version(), VERSION);
    assert_eq!(s.client.pending_upgrade(), Some(pending.clone()));

    s.set_time(pending.eta);
    s.as_signer(&s.admin, "upgrade", s.upgrade_args(), || {
        s.client.upgrade(&s.pending_hash())
    });
    let upgraded = v2::Client::new(&s.env, &s.contract);
    assert_eq!(upgraded.version(), 2);
    assert_eq!(upgraded.pending_upgrade(), None, "cleared before the swap");
}

/// The admin's signature is needed for every step, and nobody else's works.
#[test]
fn non_admin_cannot_propose_cancel_upgrade_or_set_delay() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    let before = s.snapshot();
    let longer = UPGRADE_DELAY * 2;
    for who in [&s.payer, &s.recipient, &s.arbiter, &s.stranger] {
        let args = (hash.clone(),).into_val(&s.env);
        assert_auth_abort(s.as_signer(who, "propose_upgrade", args, || {
            s.client.try_propose_upgrade(&hash)
        }));
        assert_auth_abort(s.as_signer(who, "cancel_upgrade", no_args(&s), || {
            s.client.try_cancel_upgrade()
        }));
        assert_auth_abort(s.as_signer(who, "upgrade", s.upgrade_args(), || {
            s.client.try_upgrade(&s.pending_hash())
        }));
        let args = (longer,).into_val(&s.env);
        assert_auth_abort(s.as_signer(who, "set_upgrade_delay", args, || {
            s.client.try_set_upgrade_delay(&longer)
        }));
    }
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.client.version(), VERSION);
}

#[test]
fn replacing_a_proposal_restarts_the_delay() {
    let s = Setup::new();
    let first = BytesN::from_array(&s.env, &[1; 32]);
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&first);
    let first_eta = s.client.pending_upgrade().unwrap().eta;

    s.set_time(first_eta - 10);
    s.client.propose_upgrade(&hash);
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(pending.wasm_hash, hash);
    assert_eq!(pending.eta, first_eta - 10 + UPGRADE_DELAY);

    // The old eta is no longer enough.
    s.set_time(first_eta);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::UpgradeTooEarly))
    );
    s.set_time(pending.eta);
    s.client.upgrade(&s.pending_hash());
    assert_eq!(v2::Client::new(&s.env, &s.contract).version(), 2);
}

#[test]
fn cancelled_proposal_cannot_be_executed() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    assert_eq!(
        s.client.try_cancel_upgrade(),
        Err(Ok(Error::NoPendingUpgrade))
    );
    s.client.propose_upgrade(&hash);
    let eta = s.client.pending_upgrade().unwrap().eta;
    s.as_signer(&s.admin, "cancel_upgrade", no_args(&s), || {
        s.client.cancel_upgrade()
    });
    assert_eq!(
        s.events(),
        [events::UpgradeCancelled {
            wasm_hash: hash.clone(),
        }
        .to_xdr(&s.env, &s.contract)]
    );
    assert_eq!(s.client.pending_upgrade(), None);
    s.set_time(eta);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::NoPendingUpgrade))
    );
    assert_eq!(s.client.version(), VERSION);
}

#[test]
fn lock_upgrades_clears_the_proposal_and_blocks_new_ones() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let eta = s.client.pending_upgrade().unwrap().eta;
    s.client.lock_upgrades();
    assert_eq!(
        s.events(),
        [
            events::UpgradeCancelled {
                wasm_hash: hash.clone(),
            }
            .to_xdr(&s.env, &s.contract),
            events::UpgradesLocked {}.to_xdr(&s.env, &s.contract),
        ]
    );
    assert_eq!(s.client.pending_upgrade(), None);
    s.set_time(eta);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::UpgradesLocked))
    );
    assert_eq!(
        s.client.try_propose_upgrade(&hash),
        Err(Ok(Error::UpgradesLocked))
    );
    assert_eq!(s.client.version(), VERSION);
}

#[test]
fn upgrade_delay_only_increases_within_bounds() {
    let s = Setup::new();
    for (delay, expected) in [
        (UPGRADE_DELAY - 1, Err(Ok(Error::UpgradeDelayDecrease))),
        (MIN_UPGRADE_DELAY, Err(Ok(Error::UpgradeDelayDecrease))),
        (MIN_UPGRADE_DELAY - 1, Err(Ok(Error::InvalidUpgradeDelay))),
        (MAX_UPGRADE_DELAY + 1, Err(Ok(Error::InvalidUpgradeDelay))),
        (u64::MAX, Err(Ok(Error::InvalidUpgradeDelay))),
    ] {
        assert_eq!(s.client.try_set_upgrade_delay(&delay), expected, "{delay}");
    }
    assert_eq!(s.client.upgrade_delay(), UPGRADE_DELAY);

    // Same value is fine (idempotent); a higher one sticks and is announced.
    s.client.set_upgrade_delay(&UPGRADE_DELAY);
    let args = (2 * UPGRADE_DELAY,).into_val(&s.env);
    s.as_signer(&s.admin, "set_upgrade_delay", args, || {
        s.client.set_upgrade_delay(&(2 * UPGRADE_DELAY))
    });
    assert_eq!(
        s.events(),
        [events::UpgradeDelayChanged {
            previous: UPGRADE_DELAY,
            delay: 2 * UPGRADE_DELAY,
            pending_eta: None,
        }
        .to_xdr(&s.env, &s.contract)]
    );
    assert_eq!(s.client.upgrade_delay(), 2 * UPGRADE_DELAY);
    assert_eq!(
        s.client.try_set_upgrade_delay(&UPGRADE_DELAY),
        Err(Ok(Error::UpgradeDelayDecrease))
    );
    s.client.set_upgrade_delay(&MAX_UPGRADE_DELAY);

    // New proposals use the new delay.
    s.client.propose_upgrade(&fixture_hash(&s));
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(pending.eta - pending.proposed_at, MAX_UPGRADE_DELAY);
}

/// The whole point of the delay: while an upgrade is pending, every way out
/// of every escrow still works, so users who distrust it can leave.
#[test]
fn every_exit_works_while_an_upgrade_is_pending() {
    let s = Setup::new();
    let to_release = s.funded();
    let to_refund = s.funded();
    let to_dispute = s.funded();
    let to_resolve = s.disputed();
    let to_concede = s.disputed();
    let to_cancel = s.create();
    let to_reclaim = s.create_and_fund_with(&super::Terms {
        deadline: START + 10,
        ..s.terms()
    });
    s.client.propose_upgrade(&fixture_hash(&s));
    let eta = s.client.pending_upgrade().unwrap().eta;

    for (who, act, id) in [
        (&s.payer, Act::Release, to_release),
        (&s.recipient, Act::Refund, to_refund),
        (&s.recipient, Act::Dispute(s.recipient.clone()), to_dispute),
        (&s.arbiter, Act::Resolve(AMOUNT / 2), to_resolve),
        (&s.recipient, Act::Refund, to_concede),
        (&s.payer, Act::Cancel, to_cancel),
    ] {
        assert_eq!(s.act_as(who, &act, id), Ok(Ok(())), "{act:?}");
    }
    s.set_time(START + 10);
    assert_eq!(s.act_as(&s.payer, &Act::Reclaim, to_reclaim), Ok(Ok(())));
    // New escrows and funding too (only pause blocks those).
    let late = s.funded();
    assert!(s.client.pending_upgrade().is_some());
    assert!(eta > s.env.ledger().timestamp());

    assert_eq!(s.status(to_release), Status::Released);
    assert_eq!(s.status(to_refund), Status::Refunded);
    assert_eq!(s.status(to_dispute), Status::Disputed);
    assert_eq!(s.status(to_resolve), Status::Split);
    assert_eq!(s.status(to_concede), Status::Refunded);
    assert_eq!(s.status(to_cancel), Status::Cancelled);
    assert_eq!(s.status(to_reclaim), Status::Refunded);
    assert_eq!(s.client.total_locked(), 2 * AMOUNT, "to_dispute and late");
    assert_eq!(s.status(late), Status::Funded);
    assert!(s.balance(&s.payer) < PAYER_START);
    assert!(DEADLINE > eta);
}

/// A handover never shortens the wait: the old admin's proposal is dropped,
/// and the new admin's own proposal waits the full delay.
#[test]
fn admin_handover_cancels_proposal_and_new_admin_waits() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let old_eta = s.client.pending_upgrade().unwrap().eta;

    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    s.set_time(old_eta - 1);
    let names = s.as_signer(&next, "accept_admin", no_args(&s), || {
        s.client.accept_admin();
        s.event_names()
    });
    assert_eq!(
        names,
        [
            ("upgrade_cancelled".into(), None),
            ("admin_changed".into(), None)
        ]
    );
    assert_eq!(s.client.pending_upgrade(), None, "old proposal dropped");

    // At the old eta there is nothing to run.
    s.set_time(old_eta);
    let result = s.as_signer(&next, "upgrade", s.upgrade_args(), || {
        s.client.try_upgrade(&s.pending_hash())
    });
    assert_eq!(result, Err(Ok(Error::NoPendingUpgrade)));

    // The new admin's proposal starts its own full delay.
    let args = (hash.clone(),).into_val(&s.env);
    s.as_signer(&next, "propose_upgrade", args, || {
        s.client.propose_upgrade(&hash)
    });
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(pending.eta, old_eta + UPGRADE_DELAY);
    s.set_time(pending.eta - 1);
    let result = s.as_signer(&next, "upgrade", s.upgrade_args(), || {
        s.client.try_upgrade(&s.pending_hash())
    });
    assert_eq!(result, Err(Ok(Error::UpgradeTooEarly)));
    // The old admin can't run it either.
    s.set_time(pending.eta);
    assert_auth_abort(s.as_signer(&s.admin, "upgrade", s.upgrade_args(), || {
        s.client.try_upgrade(&s.pending_hash())
    }));
    s.as_signer(&next, "upgrade", s.upgrade_args(), || {
        s.client.upgrade(&s.pending_hash())
    });
    assert_eq!(v2::Client::new(&s.env, &s.contract).version(), 2);
}

#[test]
fn propose_emits_hash_and_eta() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.set_time(START + 42);
    s.client.propose_upgrade(&hash);
    assert_eq!(
        s.events(),
        [events::UpgradeProposed {
            new_wasm_hash: hash,
            proposed_at: START + 42,
            eta: START + 42 + UPGRADE_DELAY,
            expires_at: START + 42 + UPGRADE_DELAY + UPGRADE_WINDOW,
        }
        .to_xdr(&s.env, &s.contract)]
    );
}

/// `upgrade(expected_wasm_hash)` only installs the pending hash; the checks
/// run in the order none pending (203) → wrong hash (206) → too early (204).
#[test]
fn upgrade_requires_the_pending_hash() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    let other = BytesN::from_array(&s.env, &[0x22; 32]);
    assert_eq!(
        s.client.try_upgrade(&hash),
        Err(Ok(Error::NoPendingUpgrade))
    );
    s.client.propose_upgrade(&hash);
    assert_eq!(
        s.client.try_upgrade(&other),
        Err(Ok(Error::UpgradeHashMismatch))
    );
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradeTooEarly)));
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    assert_eq!(
        s.client.try_upgrade(&other),
        Err(Ok(Error::UpgradeHashMismatch))
    );
    assert_eq!(s.client.version(), VERSION);
    s.client.upgrade(&hash);
    assert_eq!(v2::Client::new(&s.env, &s.contract).version(), 2);
}

/// A proposal can run from `eta` through `expires_at` inclusive, then never.
#[test]
fn proposal_runs_only_inside_its_window() {
    assert_eq!(UPGRADE_WINDOW, 7 * 86_400);
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(pending.expires_at, pending.eta + UPGRADE_WINDOW);
    assert_eq!(
        s.client.info().pending_upgrade_expires_at,
        Some(pending.expires_at)
    );
    s.set_time(pending.expires_at + 1);
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradeExpired)));
    // The expired proposal is still visible (so a UI can say so) and can be
    // cancelled; it can't be revived without a new delay.
    assert_eq!(s.client.pending_upgrade(), Some(pending.clone()));
    s.client.cancel_upgrade();

    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let pending = s.client.pending_upgrade().unwrap();
    s.set_time(pending.expires_at);
    s.client.upgrade(&hash);
    assert_eq!(v2::Client::new(&s.env, &s.contract).version(), 2);
}

/// Raising the delay holds a pending proposal to it, and the event says
/// where the eta ended up.
#[test]
fn raising_the_delay_moves_a_pending_eta() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let before = s.client.pending_upgrade().unwrap();

    // Same delay: nothing moves.
    s.client.set_upgrade_delay(&UPGRADE_DELAY);
    assert_eq!(s.client.pending_upgrade(), Some(before.clone()));

    s.set_time(before.eta - 10);
    s.client.set_upgrade_delay(&(3 * UPGRADE_DELAY));
    let eta = before.proposed_at + 3 * UPGRADE_DELAY;
    assert_eq!(
        s.events(),
        [events::UpgradeDelayChanged {
            previous: UPGRADE_DELAY,
            delay: 3 * UPGRADE_DELAY,
            pending_eta: Some(eta),
        }
        .to_xdr(&s.env, &s.contract)]
    );
    let after = s.client.pending_upgrade().unwrap();
    assert_eq!((after.eta, after.expires_at), (eta, eta + UPGRADE_WINDOW));
    assert_eq!(after.proposed_at, before.proposed_at);
    assert_eq!(after.wasm_hash, hash);
    s.set_time(before.eta);
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradeTooEarly)));
    s.set_time(eta);
    s.client.upgrade(&hash);
}

/// Replacing a proposal first cancels the old one, so watchers tracking
/// proposals by hash never see two open at once.
#[test]
fn replacing_a_proposal_cancels_the_old_one_first() {
    let s = Setup::new();
    let first = BytesN::from_array(&s.env, &[0x33; 32]);
    let second = fixture_hash(&s);
    s.client.propose_upgrade(&first);
    s.client.propose_upgrade(&second);
    let pending = s.client.pending_upgrade().unwrap();
    s.client.propose_upgrade(&second);
    assert_eq!(
        s.events(),
        [
            events::UpgradeCancelled {
                wasm_hash: second.clone(),
            }
            .to_xdr(&s.env, &s.contract),
            events::UpgradeProposed {
                new_wasm_hash: second.clone(),
                proposed_at: pending.proposed_at,
                eta: pending.eta,
                expires_at: pending.expires_at,
            }
            .to_xdr(&s.env, &s.contract),
        ]
    );
    s.client.propose_upgrade(&first);
    assert_eq!(
        s.event_names(),
        [
            ("upgrade_cancelled".into(), None),
            ("upgrade_proposed".into(), None)
        ]
    );
}
