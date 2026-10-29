//! Who may sign what. Every test here installs `mock_auths` for exactly one
//! signer (through `Setup::as_signer`); none relies on `mock_all_auths` for
//! the call under test. A wrong signer always fails at `require_auth`, as a
//! host abort, before any contract error code.

extern crate std;

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    Address, IntoVal, Symbol, Val, Vec,
};

use super::{assert_auth_abort, v2, Act, Setup, AMOUNT, DEADLINE, PAYER_START};
use crate::{Error, PartyRole, Status};

/// `env.auths()` must be exactly one invocation of `fn_name(args)` by `who`,
/// with the given sub-invocations.
fn assert_auth_tree(
    s: &Setup,
    who: &Address,
    fn_name: &str,
    args: Vec<Val>,
    subs: std::vec::Vec<AuthorizedInvocation>,
) {
    assert_eq!(
        s.env.auths(),
        std::vec![(
            who.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.contract.clone(),
                    Symbol::new(&s.env, fn_name),
                    args,
                )),
                sub_invocations: subs,
            }
        )]
    );
}

/// The payer → contract transfer a funding call authorizes.
fn transfer_sub(s: &Setup, amount: i128) -> AuthorizedInvocation {
    AuthorizedInvocation {
        function: AuthorizedFunction::Contract((
            s.usdc.address.clone(),
            symbol_short!("transfer"),
            (s.payer.clone(), s.contract.clone(), amount).into_val(&s.env),
        )),
        sub_invocations: std::vec![],
    }
}

fn no_args(s: &Setup) -> Vec<Val> {
    Vec::new(&s.env)
}

/// Asserts each of `who` is refused `act` on `id` at auth, and that nothing
/// changed.
fn assert_rejects(s: &Setup, who: &[&Address], act: &Act, id: u64) {
    let before = s.snapshot();
    for w in who {
        assert_auth_abort(s.act_as(w, act, id));
    }
    assert_eq!(s.snapshot(), before, "{act:?} refused but state changed");
}

/// Nobody can create an escrow that names someone else as payer.
#[test]
fn create_requires_payer_signature() {
    let s = Setup::new();
    let t = s.terms();
    for who in [&s.stranger, &s.recipient, &s.arbiter, &s.admin] {
        let result = s.as_signer(who, "create", t.args(&s.env), || s.try_create(&t));
        assert_auth_abort(result);
    }
    assert_eq!(s.client.escrow_count(), 0);

    let id = s.as_signer(&s.payer, "create", t.args(&s.env), || {
        let id = s.try_create(&t).unwrap().unwrap();
        assert_auth_tree(&s, &s.payer, "create", t.args(&s.env), std::vec![]);
        id
    });
    assert_eq!(s.status(id), Status::Created);
}

/// Nobody can spend the payer's money.
#[test]
fn create_and_fund_requires_payer_signature() {
    let s = Setup::new();
    let t = s.terms();
    for who in [&s.stranger, &s.recipient, &s.arbiter, &s.admin] {
        let result = s.as_signer(who, "create_and_fund", t.args(&s.env), || {
            s.try_create_and_fund(&t)
        });
        assert_auth_abort(result);
    }
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.client.escrow_count(), 0);
    assert_eq!(s.client.party_escrow_count(&s.payer, &PartyRole::Payer), 0);
}

/// One signature from the payer covers the call and the USDC transfer.
#[test]
fn create_and_fund_is_one_payer_auth_tree() {
    let s = Setup::new();
    let t = s.terms();
    let id = s.as_signer(&s.payer, "create_and_fund", t.args(&s.env), || {
        let id = s.try_create_and_fund(&t).unwrap().unwrap();
        assert_auth_tree(
            &s,
            &s.payer,
            "create_and_fund",
            t.args(&s.env),
            std::vec![transfer_sub(&s, AMOUNT)],
        );
        id
    });
    assert_eq!(s.status(id), Status::Funded);
}

#[test]
fn fund_rejects_everyone_but_payer() {
    let s = Setup::new();
    let id = s.create();
    assert_rejects(
        &s,
        &[&s.recipient, &s.arbiter, &s.admin, &s.stranger],
        &Act::Fund,
        id,
    );
    s.as_signer(&s.payer, "fund", (id,).into_val(&s.env), || {
        s.client.fund(&id);
        assert_auth_tree(
            &s,
            &s.payer,
            "fund",
            (id,).into_val(&s.env),
            std::vec![transfer_sub(&s, AMOUNT)],
        );
    });
    assert_eq!(s.status(id), Status::Funded);
}

#[test]
fn release_rejects_recipient_arbiter_admin_stranger() {
    let s = Setup::new();
    let id = s.funded();
    let wrong = [&s.recipient, &s.arbiter, &s.admin, &s.stranger];
    assert_rejects(&s, &wrong, &Act::Release, id);
    // Also while disputed, where the payer may concede.
    s.client.dispute(&id, &s.recipient);
    assert_rejects(&s, &wrong, &Act::Release, id);
    s.act_as(&s.payer, &Act::Release, id).unwrap().unwrap();
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

#[test]
fn refund_rejects_payer_arbiter_admin_stranger() {
    let s = Setup::new();
    let id = s.funded();
    let wrong = [&s.payer, &s.arbiter, &s.admin, &s.stranger];
    assert_rejects(&s, &wrong, &Act::Refund, id);
    s.client.dispute(&id, &s.payer);
    assert_rejects(&s, &wrong, &Act::Refund, id);
    s.as_signer(&s.recipient, "refund", (id,).into_val(&s.env), || {
        s.client.refund(&id);
        assert_auth_tree(
            &s,
            &s.recipient,
            "refund",
            (id,).into_val(&s.env),
            std::vec![],
        );
    });
    assert_eq!(s.status(id), Status::Refunded);
}

#[test]
fn reclaim_rejects_everyone_but_payer() {
    let s = Setup::new();
    let id = s.funded();
    s.set_time(DEADLINE);
    assert_rejects(
        &s,
        &[&s.recipient, &s.arbiter, &s.admin, &s.stranger],
        &Act::Reclaim,
        id,
    );
    s.as_signer(&s.payer, "reclaim", (id,).into_val(&s.env), || {
        s.client.reclaim(&id);
        assert_auth_tree(&s, &s.payer, "reclaim", (id,).into_val(&s.env), std::vec![]);
    });
    assert_eq!(s.balance(&s.payer), PAYER_START);
}

#[test]
fn cancel_rejects_everyone_but_payer() {
    let s = Setup::new();
    let id = s.create();
    assert_rejects(
        &s,
        &[&s.recipient, &s.arbiter, &s.admin, &s.stranger],
        &Act::Cancel,
        id,
    );
    s.as_signer(&s.payer, "cancel", (id,).into_val(&s.env), || {
        s.client.cancel(&id);
        assert_auth_tree(&s, &s.payer, "cancel", (id,).into_val(&s.env), std::vec![]);
    });
    assert_eq!(s.status(id), Status::Cancelled);
}

/// `dispute(id, by)` needs `by`'s own signature.
#[test]
fn dispute_requires_signature_of_by() {
    let s = Setup::new();
    let id = s.funded();
    let as_recipient = Act::Dispute(s.recipient.clone());
    assert_rejects(
        &s,
        &[&s.stranger, &s.payer, &s.arbiter, &s.admin],
        &as_recipient,
        id,
    );
    let args = (id, s.recipient.clone()).into_val(&s.env);
    s.as_signer(&s.recipient, "dispute", args, || {
        s.client.dispute(&id, &s.recipient);
        assert_auth_tree(
            &s,
            &s.recipient,
            "dispute",
            (id, s.recipient.clone()).into_val(&s.env),
            std::vec![],
        );
    });
    assert_eq!(s.status(id), Status::Disputed);
}

/// Signing as yourself is not enough: only the payer or the recipient may
/// open a dispute.
#[test]
fn dispute_by_non_party_fails_not_party() {
    let s = Setup::new();
    let id = s.funded();
    let before = s.snapshot();
    for who in [&s.arbiter, &s.stranger, &s.admin] {
        assert_eq!(
            s.act_as(who, &Act::Dispute(who.clone()), id),
            Err(Ok(Error::NotParty))
        );
    }
    assert_eq!(s.snapshot(), before);
}

#[test]
fn resolve_rejects_everyone_but_arbiter() {
    let s = Setup::new();
    let id = s.disputed();
    for amount in [0, AMOUNT / 2, AMOUNT] {
        assert_rejects(
            &s,
            &[&s.payer, &s.recipient, &s.admin, &s.stranger],
            &Act::Resolve(amount),
            id,
        );
    }
    let args = (id, AMOUNT / 2).into_val(&s.env);
    s.as_signer(&s.arbiter, "resolve", args, || {
        s.client.resolve(&id, &(AMOUNT / 2));
        assert_auth_tree(
            &s,
            &s.arbiter,
            "resolve",
            (id, AMOUNT / 2).into_val(&s.env),
            std::vec![],
        );
    });
    assert_eq!(s.status(id), Status::Split);
}

#[test]
fn admin_functions_reject_non_admin() {
    let s = Setup::new();
    let id = s.funded();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    // Proposals exist and the upgrade is past its eta, so cancel_*, upgrade
    // would otherwise succeed.
    s.client.propose_admin(&s.stranger);
    s.client.propose_upgrade(&hash);
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    let before = s.snapshot();

    for who in [&s.payer, &s.recipient, &s.arbiter, &s.stranger] {
        assert_auth_abort(
            s.as_signer(who, "set_paused", (true,).into_val(&s.env), || {
                s.client.try_set_paused(&true)
            }),
        );
        let args = (who.clone(),).into_val(&s.env);
        assert_auth_abort(s.as_signer(who, "propose_admin", args, || {
            s.client.try_propose_admin(who)
        }));
        assert_auth_abort(s.as_signer(who, "cancel_admin_proposal", no_args(&s), || {
            s.client.try_cancel_admin_proposal()
        }));
        let args = (hash.clone(),).into_val(&s.env);
        assert_auth_abort(s.as_signer(who, "propose_upgrade", args, || {
            s.client.try_propose_upgrade(&hash)
        }));
        assert_auth_abort(s.as_signer(who, "upgrade", s.upgrade_args(), || {
            s.client.try_upgrade(&s.pending_hash())
        }));
        assert_auth_abort(s.as_signer(who, "cancel_upgrade", no_args(&s), || {
            s.client.try_cancel_upgrade()
        }));
        let delay = super::UPGRADE_DELAY * 2;
        assert_auth_abort(
            s.as_signer(who, "set_upgrade_delay", (delay,).into_val(&s.env), || {
                s.client.try_set_upgrade_delay(&delay)
            }),
        );
        assert_auth_abort(s.as_signer(who, "lock_upgrades", no_args(&s), || {
            s.client.try_lock_upgrades()
        }));
    }
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.client.version(), crate::VERSION);
    assert_eq!(s.status(id), Status::Funded);

    // The admin's own signature on exactly the call is enough.
    s.as_signer(&s.admin, "set_paused", (true,).into_val(&s.env), || {
        s.client.set_paused(&true);
        assert_auth_tree(
            &s,
            &s.admin,
            "set_paused",
            (true,).into_val(&s.env),
            std::vec![],
        );
    });
    assert!(s.client.is_paused());
}

#[test]
fn accept_admin_rejects_everyone_but_pending() {
    let s = Setup::new();
    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    for who in [&s.admin, &s.payer, &s.stranger] {
        assert_auth_abort(s.as_signer(who, "accept_admin", no_args(&s), || {
            s.client.try_accept_admin()
        }));
    }
    assert_eq!(s.client.admin(), s.admin);
    s.as_signer(&next, "accept_admin", no_args(&s), || {
        s.client.accept_admin();
        assert_auth_tree(&s, &next, "accept_admin", no_args(&s), std::vec![]);
    });
    assert_eq!(s.client.admin(), next);
}

/// I7/I8: the admin's signature opens no escrow path at all.
#[test]
fn admin_cannot_perform_any_escrow_action() {
    let s = Setup::new();
    let t = s.terms();
    assert_auth_abort(s.as_signer(&s.admin, "create", t.args(&s.env), || s.try_create(&t)));
    assert_auth_abort(
        s.as_signer(&s.admin, "create_and_fund", t.args(&s.env), || {
            s.try_create_and_fund(&t)
        }),
    );

    let created = s.create();
    let funded = s.funded();
    let disputed = s.disputed();
    let before = s.snapshot();
    for (act, id) in [
        (Act::Fund, created),
        (Act::Cancel, created),
        (Act::Release, funded),
        (Act::Refund, funded),
        (Act::Dispute(s.payer.clone()), funded),
        (Act::Dispute(s.recipient.clone()), funded),
        (Act::Release, disputed),
        (Act::Refund, disputed),
        (Act::Resolve(AMOUNT), disputed),
        (Act::Resolve(0), disputed),
    ] {
        assert_auth_abort(s.act_as(&s.admin, &act, id));
    }
    s.set_time(DEADLINE);
    assert_auth_abort(s.act_as(&s.admin, &Act::Reclaim, funded));
    assert_eq!(s.snapshot(), before);
}

#[test]
fn release_auth_tree_is_exactly_payer_release_id() {
    let s = Setup::new();
    let id = s.funded();
    s.as_signer(&s.payer, "release", (id,).into_val(&s.env), || {
        s.client.release(&id);
        // No sub-invocations: the outgoing transfer is authorized by the
        // contract itself, not by the payer.
        assert_auth_tree(&s, &s.payer, "release", (id,).into_val(&s.env), std::vec![]);
    });
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

#[test]
fn ttl_bumps_need_no_auth() {
    let s = Setup::new();
    let id = s.funded();
    s.env.mock_auths(&[]);
    s.client.extend_escrow_ttl(&id);
    assert!(s.env.auths().is_empty());
    s.client.extend_index_ttl(&s.payer, &PartyRole::Payer, &0);
    assert!(s.env.auths().is_empty());
    s.client
        .extend_index_ttl(&s.stranger, &PartyRole::Arbiter, &9);
    assert!(s.env.auths().is_empty());
    s.env.mock_all_auths();
}
