//! Adversarial suite: an attacker with real money at stake tries to steal,
//! freeze, double-spend or misroute escrowed funds.
//!
//! Convention: a test marked `// VULN:` asserts the SAFE behaviour and fails
//! while the vulnerability exists. Every other test is an attack the contract
//! currently defends, and passes.
//!
//! Auth attacks use `mock_auths` with explicit signers (through
//! `Setup::as_signer` or a hand-built `MockAuth`), never `mock_all_auths`
//! for the attacked call. `mock_all_auths` is used for setup, and for
//! non-auth attacks where it gives the attacker *more* power than reality
//! (every signature it wants), so a pass there is a strong result.

extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, IssuerFlags, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Address, Env, IntoVal, MuxedAddress, Val, Vec,
};

use super::{
    assert_auth_abort, new_env, v2, Act, Setup, Terms, AMOUNT, DAY, DEADLINE, PAYER_START, START,
};
use crate::{DataKey, Error, PartyRole, SisonkeEscrowClient, Status, MAX_DURATION};

// ================================================================ helpers

/// Every action, with the legitimate argument shapes, for sweeps.
fn all_acts(s: &Setup) -> std::vec::Vec<Act> {
    std::vec![
        Act::Fund,
        Act::Cancel,
        Act::Release,
        Act::Refund,
        Act::Reclaim,
        Act::Dispute(s.payer.clone()),
        Act::Dispute(s.recipient.clone()),
        Act::Resolve(0),
        Act::Resolve(1),
        Act::Resolve(AMOUNT),
    ]
}

/// Conservation (I1) plus "the contract actually holds what it owes".
fn assert_conserved(s: &Setup) {
    let snap = s.snapshot();
    let locked: i128 = snap
        .escrows
        .iter()
        .filter(|e| matches!(e.status, Status::Funded | Status::Disputed))
        .map(|e| e.amount)
        .sum();
    assert_eq!(snap.total_locked, locked, "TotalLocked drifted");
    assert!(
        s.balance(&s.contract) >= locked,
        "contract holds less than it owes"
    );
    for e in &snap.escrows {
        match e.status {
            Status::Released | Status::Refunded | Status::Split => {
                assert_eq!(e.paid_to_payer + e.paid_to_recipient, e.amount)
            }
            _ => assert_eq!((e.paid_to_payer, e.paid_to_recipient), (0, 0)),
        }
    }
}

/// Signs `fn_name(args)` on the escrow as `who`, with an explicit
/// payer → contract transfer sub-invocation of `transfer_amount`.
fn sign_with_transfer(
    s: &Setup,
    who: &Address,
    fn_name: &str,
    args: Vec<Val>,
    transfer_amount: i128,
) {
    let sub = [MockAuthInvoke {
        contract: &s.usdc.address,
        fn_name: "transfer",
        args: (who.clone(), s.contract.clone(), transfer_amount).into_val(&s.env),
        sub_invokes: &[],
    }];
    s.env.mock_auths(&[MockAuth {
        address: who,
        invoke: &MockAuthInvoke {
            contract: &s.contract,
            fn_name,
            args,
            sub_invokes: &sub,
        },
    }]);
}

fn sign(s: &Setup, who: &Address, fn_name: &str, args: Vec<Val>) {
    s.env.mock_auths(&[MockAuth {
        address: who,
        invoke: &MockAuthInvoke {
            contract: &s.contract,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

// ===================================================== 1. outsiders & roles

/// Stranger, arbiter (outside `resolve`), admin and the wrong party try every
/// fund-moving or state-changing call in every live status, each signing only
/// for themselves. All must abort at auth, and nothing may change.
#[test]
fn outsiders_cannot_move_or_freeze_funds_in_any_live_status() {
    let s = Setup::new();
    let created = s.create();
    let funded = s.funded();
    let disputed = s.disputed();
    let late = s.funded(); // will be past its deadline

    let before = s.snapshot();
    for &id in &[created, funded, disputed, late] {
        for time in [START, DEADLINE, DEADLINE + 365 * DAY] {
            s.set_time(time);
            // Who must never be accepted for each act.
            let cases: std::vec::Vec<(Act, std::vec::Vec<&Address>)> = std::vec![
                (
                    Act::Fund,
                    std::vec![&s.recipient, &s.arbiter, &s.admin, &s.stranger]
                ),
                (
                    Act::Cancel,
                    std::vec![&s.recipient, &s.arbiter, &s.admin, &s.stranger]
                ),
                (
                    Act::Release,
                    std::vec![&s.recipient, &s.arbiter, &s.admin, &s.stranger]
                ),
                (
                    Act::Refund,
                    std::vec![&s.payer, &s.arbiter, &s.admin, &s.stranger]
                ),
                (
                    Act::Reclaim,
                    std::vec![&s.recipient, &s.arbiter, &s.admin, &s.stranger]
                ),
                // Impersonating a party in `by`.
                (
                    Act::Dispute(s.payer.clone()),
                    std::vec![&s.recipient, &s.arbiter, &s.admin, &s.stranger]
                ),
                (
                    Act::Dispute(s.recipient.clone()),
                    std::vec![&s.payer, &s.arbiter, &s.admin, &s.stranger]
                ),
                (
                    Act::Resolve(AMOUNT),
                    std::vec![&s.payer, &s.recipient, &s.admin, &s.stranger]
                ),
                (
                    Act::Resolve(0),
                    std::vec![&s.payer, &s.recipient, &s.admin, &s.stranger]
                ),
            ];
            for (act, attackers) in cases {
                for who in attackers {
                    let r = s.act_as(who, &act, id);
                    assert_auth_abort(r);
                }
            }
        }
    }
    s.set_time(START);
    assert_eq!(
        s.snapshot(),
        before,
        "a refused outsider call changed state"
    );
}

/// A non-party signing `dispute(id, themselves)` passes auth and must still
/// be refused (105), with nothing changed.
#[test]
fn outsider_naming_self_in_dispute_is_not_party() {
    let s = Setup::new();
    let id = s.funded();
    let before = s.snapshot();
    for who in [&s.stranger, &s.arbiter, &s.admin] {
        let act = Act::Dispute(who.clone());
        assert_eq!(s.act_as(who, &act, id), Err(Ok(Error::NotParty)), "{who:?}");
    }
    assert_eq!(s.snapshot(), before);
}

/// Arbiter of escrow A tries to resolve escrow B (different arbiter) in its
/// own favour-party's direction. Signature is A's arbiter only.
#[test]
fn arbiter_cannot_resolve_an_escrow_it_does_not_arbitrate() {
    let s = Setup::new();
    let other_arbiter = Address::generate(&s.env);
    let mine = s.disputed();
    let theirs = s.create_and_fund_with(&Terms {
        arbiter: Some(other_arbiter.clone()),
        ..s.terms()
    });
    s.client.dispute(&theirs, &s.recipient);
    let before = s.snapshot();
    for split in [0, AMOUNT / 2, AMOUNT] {
        assert_auth_abort(s.act_as(&s.arbiter, &Act::Resolve(split), theirs));
    }
    // And a stranger escrow arbiter can't touch `mine`.
    assert_auth_abort(s.act_as(&other_arbiter, &Act::Resolve(0), mine));
    assert_eq!(s.snapshot(), before);
}

/// The arbiter has no power before a dispute: `resolve` on Created or
/// Funded is refused even with its valid signature.
#[test]
fn arbiter_powerless_without_open_dispute() {
    let s = Setup::new();
    let created = s.create();
    let funded = s.funded();
    let before = s.snapshot();
    for id in [created, funded] {
        for split in [0, 1, AMOUNT] {
            assert_eq!(
                s.act_as(&s.arbiter, &Act::Resolve(split), id),
                Err(Ok(Error::InvalidStatus))
            );
        }
    }
    s.set_time(DEADLINE + DAY);
    assert_eq!(
        s.act_as(&s.arbiter, &Act::Resolve(AMOUNT), funded),
        Err(Ok(Error::InvalidStatus))
    );
    s.set_time(START);
    assert_eq!(s.snapshot(), before);
}

/// No-arbiter escrows: nobody, whatever they sign, can open or resolve a
/// dispute, so there is no back door "arbiter = None = anyone".
#[test]
fn no_arbiter_means_no_resolver_at_all() {
    let s = Setup::new();
    let id = s.create_and_fund_with(&s.terms_no_arbiter());
    let before = s.snapshot();
    for who in [&s.payer, &s.recipient, &s.arbiter, &s.admin, &s.stranger] {
        assert_eq!(
            s.act_as(who, &Act::Resolve(AMOUNT), id),
            Err(Ok(Error::NoArbiter))
        );
    }
    for by in [&s.payer, &s.recipient] {
        assert_eq!(
            s.act_as(by, &Act::Dispute(by.clone()), id),
            Err(Ok(Error::NoArbiter))
        );
    }
    assert_eq!(s.snapshot(), before);
}

/// Role aliasing at creation: every collapse of two roles into one address,
/// or a role equal to the escrow contract itself, is refused by both entry
/// points even when every signature is available.
#[test]
fn role_aliasing_is_refused_at_create() {
    let s = Setup::new();
    let base = s.terms();
    let c = s.contract.clone();
    let cases: std::vec::Vec<(Terms, Error)> = std::vec![
        (
            Terms {
                recipient: s.payer.clone(),
                ..base.clone()
            },
            Error::SameParty
        ),
        (
            Terms {
                recipient: s.payer.clone(),
                arbiter: None,
                ..base.clone()
            },
            Error::SameParty
        ),
        (
            Terms {
                arbiter: Some(s.payer.clone()),
                ..base.clone()
            },
            Error::InvalidArbiter
        ),
        (
            Terms {
                arbiter: Some(s.recipient.clone()),
                ..base.clone()
            },
            Error::InvalidArbiter
        ),
        (
            Terms {
                arbiter: Some(c.clone()),
                ..base.clone()
            },
            Error::InvalidParty
        ),
        (
            Terms {
                recipient: c.clone(),
                ..base.clone()
            },
            Error::InvalidParty
        ),
        (
            Terms {
                payer: c.clone(),
                ..base.clone()
            },
            Error::InvalidParty
        ),
        (
            Terms {
                payer: c.clone(),
                recipient: c.clone(),
                arbiter: Some(c.clone()),
                ..base.clone()
            },
            Error::SameParty
        ),
    ];
    let before = s.snapshot();
    for (t, err) in cases {
        assert_eq!(s.try_create(&t), Err(Ok(err)), "create {t:?}");
        assert_eq!(
            s.try_create_and_fund(&t),
            Err(Ok(err)),
            "create_and_fund {t:?}"
        );
    }
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.client.escrow_count(), 0);
    assert_eq!(s.client.party_escrow_count(&c, &PartyRole::Recipient), 0);
}

// ================================================ 2. duplicates & finality

/// Reach every final status by every path, then throw every action at it at
/// several times with every signature available. All must be 101 and change
/// nothing: no double payout, no regression, no re-fund.
#[test]
fn every_final_status_is_absorbing_against_every_action() {
    let s = Setup::new();
    let mut closed: std::vec::Vec<(u64, Status)> = std::vec![];

    let a = s.funded();
    s.client.release(&a);
    closed.push((a, Status::Released));
    let b = s.funded();
    s.client.refund(&b);
    closed.push((b, Status::Refunded));
    for (split, st) in [
        (0, Status::Refunded),
        (1, Status::Split),
        (AMOUNT, Status::Released),
    ] {
        let id = s.disputed();
        s.client.resolve(&id, &split);
        closed.push((id, st));
    }
    let c = s.disputed();
    s.client.release(&c); // payer concedes
    closed.push((c, Status::Released));
    let d = s.disputed();
    s.client.refund(&d); // recipient concedes
    closed.push((d, Status::Refunded));
    let e = s.create();
    s.client.cancel(&e);
    closed.push((e, Status::Cancelled));
    let f = s.funded();
    s.set_time(DEADLINE);
    s.client.reclaim(&f);
    closed.push((f, Status::Refunded));

    let before = s.snapshot();
    for time in [START, DEADLINE - 1, DEADLINE, DEADLINE + 400 * DAY] {
        s.set_time(time);
        for &(id, st) in &closed {
            assert_eq!(s.status(id), st);
            for act in all_acts(&s) {
                assert_eq!(
                    s.try_act(&act, id),
                    Err(Ok(Error::InvalidStatus)),
                    "{act:?} on {st:?} escrow {id} at {time}"
                );
            }
        }
    }
    s.set_time(DEADLINE);
    assert_eq!(s.snapshot(), before, "a duplicate changed state");
    assert_conserved(&s);
}

/// Forward-only on live escrows: no second fund, no cancel once funded, no
/// second dispute, no reclaim once disputed (even years later), no fund of
/// a cancelled escrow.
#[test]
fn live_escrows_never_regress() {
    let s = Setup::new();
    let funded = s.funded();
    let disputed = s.disputed();
    let cancelled = s.create();
    s.client.cancel(&cancelled);
    let before = s.snapshot();

    assert_eq!(s.client.try_fund(&funded), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.client.try_cancel(&funded), Err(Ok(Error::InvalidStatus)));
    assert_eq!(s.client.try_fund(&disputed), Err(Ok(Error::InvalidStatus)));
    assert_eq!(
        s.client.try_cancel(&disputed),
        Err(Ok(Error::InvalidStatus))
    );
    for by in [&s.payer, &s.recipient] {
        assert_eq!(
            s.client.try_dispute(&disputed, by),
            Err(Ok(Error::InvalidStatus))
        );
    }
    assert_eq!(s.client.try_fund(&cancelled), Err(Ok(Error::InvalidStatus)));
    for t in [DEADLINE, DEADLINE + 1, u64::MAX] {
        s.set_time(t);
        assert_eq!(
            s.client.try_reclaim(&disputed),
            Err(Ok(Error::InvalidStatus))
        );
    }
    s.set_time(START);
    assert_eq!(s.snapshot(), before);
}

// =========================================================== 3. deadlines

/// Race at the deadline: at every second around it, exactly one of
/// {recipient disputes, payer reclaims} is possible, never both and never
/// neither. Once one wins, the other is shut out for good.
#[test]
fn dispute_and_reclaim_are_mutually_exclusive_at_every_second() {
    let s = Setup::new();
    for t in [DEADLINE - 2, DEADLINE - 1, DEADLINE, DEADLINE + 1] {
        s.set_time(START);
        let d = s.funded();
        let r = s.funded();
        s.set_time(t);
        let can_dispute = s
            .act_as(&s.recipient, &Act::Dispute(s.recipient.clone()), d)
            .is_ok();
        let can_reclaim = s.act_as(&s.payer, &Act::Reclaim, r).is_ok();
        assert!(
            can_dispute ^ can_reclaim,
            "t = {t}: dispute {can_dispute}, reclaim {can_reclaim}"
        );
        assert_eq!(can_dispute, t < DEADLINE);

        // Loser of the race is shut out on the winner's escrow, at any later time.
        s.set_time(t.max(DEADLINE) + 10 * DAY);
        if can_dispute {
            assert_eq!(
                s.act_as(&s.payer, &Act::Reclaim, d),
                Err(Ok(Error::InvalidStatus))
            );
        } else {
            assert_eq!(
                s.act_as(&s.recipient, &Act::Dispute(s.recipient.clone()), r),
                Err(Ok(Error::InvalidStatus))
            );
        }
    }
    s.set_time(DEADLINE + 30 * DAY);
    assert_conserved(&s);
}

/// Deadline extremes at create, including a ledger clock at the very end of
/// u64. Nothing panics, nothing wraps, and an escrow created at the end of
/// time can still be reclaimed.
#[test]
fn deadline_extremes_cannot_wrap_or_lock() {
    let s = Setup::new();
    let at = |deadline| Terms {
        deadline,
        ..s.terms()
    };
    assert_eq!(s.try_create(&at(0)), Err(Ok(Error::DeadlineInPast)));
    assert_eq!(s.try_create(&at(START)), Err(Ok(Error::DeadlineInPast)));
    assert_eq!(s.try_create(&at(u64::MAX)), Err(Ok(Error::DeadlineTooFar)));
    assert_eq!(
        s.try_create(&at(START + MAX_DURATION + 1)),
        Err(Ok(Error::DeadlineTooFar))
    );
    let max = s.create_and_fund_with(&at(START + MAX_DURATION));
    assert_eq!(s.status(max), Status::Funded);

    // Clock near the end of u64: saturating bound, still consistent.
    s.set_time(u64::MAX - 5);
    let end = s.create_and_fund_with(&at(u64::MAX));
    assert_eq!(
        s.act_as(&s.payer, &Act::Reclaim, end),
        Err(Ok(Error::DeadlineNotReached))
    );
    s.set_time(u64::MAX);
    assert_eq!(
        s.client.try_create(
            &s.payer,
            &s.recipient,
            &None,
            &AMOUNT,
            &u64::MAX,
            &s.str(""),
            &None
        ),
        Err(Ok(Error::DeadlineInPast))
    );
    let payer_before = s.balance(&s.payer);
    assert_eq!(s.act_as(&s.payer, &Act::Reclaim, end), Ok(Ok(())));
    assert_eq!(s.balance(&s.payer), payer_before + AMOUNT);
    assert_conserved(&s);
}

// ============================================================== 4. amounts

#[test]
fn non_positive_amounts_are_refused() {
    let s = Setup::new();
    let before = s.snapshot();
    for amount in [0, -1, -AMOUNT, i128::MIN] {
        let t = Terms {
            amount,
            ..s.terms()
        };
        assert_eq!(s.try_create(&t), Err(Ok(Error::InvalidAmount)));
        assert_eq!(s.try_create_and_fund(&t), Err(Ok(Error::InvalidAmount)));
    }
    assert_eq!(s.snapshot(), before);
}

/// Split extremes: negative, more than the amount, and the integer limits.
/// None may pay out more than the escrow holds or move anything.
#[test]
fn split_extremes_are_refused() {
    let s = Setup::new();
    let other = s.funded(); // other escrow's funds must never be reachable
    let id = s.disputed();
    let before = s.snapshot();
    for split in [
        -1,
        AMOUNT + 1,
        2 * AMOUNT,
        i128::MAX,
        i128::MIN,
        i128::MIN + 1,
    ] {
        assert_eq!(
            s.act_as(&s.arbiter, &Act::Resolve(split), id),
            Err(Ok(Error::InvalidSplit)),
            "split {split}"
        );
    }
    assert_eq!(s.snapshot(), before);
    // The legal extreme closes exactly once and leaves `other` alone.
    assert_eq!(
        s.act_as(&s.arbiter, &Act::Resolve(AMOUNT - 1), id),
        Ok(Ok(()))
    );
    let e = s.escrow(id);
    assert_eq!(
        (e.paid_to_recipient, e.paid_to_payer, e.status),
        (AMOUNT - 1, 1, Status::Split)
    );
    assert_eq!(s.status(other), Status::Funded);
    assert_eq!(s.balance(&s.contract), AMOUNT);
    assert_conserved(&s);
}

/// A whale fills `TotalLocked` up to i128::MAX; the next funding overflows.
/// It must be refused cleanly (143) with no corruption, and the whale's own
/// escrow must still settle. (Unreachable with real USDC: total supply is far
/// below i128::MAX.)
#[test]
fn total_locked_overflow_refused_without_corruption() {
    let s = Setup::new();
    let whale_amount = i128::MAX - PAYER_START;
    s.usdc_admin.mint(&s.payer, &whale_amount); // payer now holds i128::MAX
    let whale = s.create_and_fund_with(&Terms {
        amount: i128::MAX - 10,
        ..s.terms()
    });
    assert_eq!(s.client.total_locked(), i128::MAX - 10);

    let small_payer = Address::generate(&s.env);
    s.usdc_admin.mint(&small_payer, &100);
    let t = Terms {
        payer: small_payer.clone(),
        amount: 11,
        ..s.terms()
    };
    let before = s.snapshot();
    assert_eq!(s.try_create_and_fund(&t), Err(Ok(Error::Overflow)));
    let pending = s.create_with(&t);
    let before_fund = s.snapshot();
    assert_eq!(s.client.try_fund(&pending), Err(Ok(Error::Overflow)));
    assert_eq!(s.snapshot(), before_fund);
    assert_eq!(before.total_locked, i128::MAX - 10);

    s.client.refund(&whale);
    assert_eq!(s.client.total_locked(), 0);
    s.client.fund(&pending);
    assert_conserved(&s);
}

/// Donations to the contract are never paid out to anyone, and closing every
/// escrow leaves exactly the donation behind (accounting never counts it).
#[test]
fn donation_is_never_claimable_and_accounting_stays_exact() {
    let s = Setup::new();
    let ids = [s.funded(), s.funded(), s.disputed(), s.create()];
    let donation = 12_345;
    s.usdc_admin.mint(&s.stranger, &donation);
    s.usdc.transfer(&s.stranger, &s.contract, &donation);
    assert_conserved(&s);

    s.client.release(&ids[0]);
    s.client.refund(&ids[1]);
    s.client.resolve(&ids[2], &(AMOUNT / 3));
    s.client.cancel(&ids[3]);
    assert_eq!(s.client.total_locked(), 0);
    assert_eq!(
        s.balance(&s.contract),
        donation,
        "donation must stay, untouched"
    );
    assert_eq!(s.balance(&s.payer) + s.balance(&s.recipient), PAYER_START);
    assert_conserved(&s);
}

// ============================================ 5. auth binding & replay

/// A payer signature for `release(1)` used on `release(2)` (same payer).
#[test]
fn release_signature_is_bound_to_escrow_id() {
    let s = Setup::new();
    let one = s.funded();
    let two = s.funded();
    let before = s.snapshot();
    sign(&s, &s.payer, "release", (one,).into_val(&s.env));
    assert_auth_abort(s.client.try_release(&two));
    sign(&s, &s.payer, "reclaim", (one,).into_val(&s.env));
    s.set_time(DEADLINE);
    assert_auth_abort(s.client.try_reclaim(&two));
    s.set_time(START);
    s.env.mock_all_auths();
    assert_eq!(s.snapshot(), before);
}

/// A payer signature for `fund(1)` (with its transfer) used for `fund(2)`.
#[test]
fn fund_signature_is_bound_to_escrow_id() {
    let s = Setup::new();
    let one = s.create();
    let two = s.create();
    sign_with_transfer(&s, &s.payer, "fund", (one,).into_val(&s.env), AMOUNT);
    assert_auth_abort(s.client.try_fund(&two));
    s.env.mock_all_auths();
    assert_eq!(s.status(two), Status::Created);
    assert_eq!(s.balance(&s.payer), PAYER_START);
}

/// Payer signs `create_and_fund` for X; attacker submits it with 2X, or with
/// a transfer sub-auth that doesn't match the call's amount.
#[test]
fn create_and_fund_signature_is_bound_to_amount() {
    let s = Setup::new();
    let signed = s.terms();
    let bigger = Terms {
        amount: 2 * AMOUNT,
        ..signed.clone()
    };

    // Same transfer, bigger call.
    sign_with_transfer(&s, &s.payer, "create_and_fund", signed.args(&s.env), AMOUNT);
    assert_auth_abort(s.try_create_and_fund(&bigger));
    // Call and root match, but the transfer authorised is for 2X: the
    // contract pulls exactly X, which was not authorised.
    sign_with_transfer(
        &s,
        &s.payer,
        "create_and_fund",
        signed.args(&s.env),
        2 * AMOUNT,
    );
    assert_auth_abort(s.try_create_and_fund(&signed));
    // Root says 2X, transfer says X: refused too.
    sign_with_transfer(&s, &s.payer, "create_and_fund", bigger.args(&s.env), AMOUNT);
    assert_auth_abort(s.try_create_and_fund(&bigger));

    s.env.mock_all_auths();
    assert_eq!(s.client.escrow_count(), 0);
    assert_eq!(s.balance(&s.payer), PAYER_START);
}

/// Payer signs terms T; attacker swaps recipient, arbiter, deadline, title or
/// terms_hash before submitting.
#[test]
fn create_signature_is_bound_to_every_term() {
    let s = Setup::new();
    let signed = s.terms();
    let evil = Address::generate(&s.env);
    let tampered = std::vec![
        Terms {
            recipient: evil.clone(),
            ..signed.clone()
        },
        Terms {
            arbiter: Some(evil.clone()),
            ..signed.clone()
        },
        Terms {
            arbiter: None,
            ..signed.clone()
        },
        Terms {
            deadline: START + 1,
            ..signed.clone()
        },
        Terms {
            title: s.str("other"),
            ..signed.clone()
        },
        Terms {
            terms_hash: Some(s.hash(9)),
            ..signed.clone()
        },
        Terms {
            terms_hash: None,
            ..signed.clone()
        },
    ];
    for t in &tampered {
        sign(&s, &s.payer, "create", signed.args(&s.env));
        assert_auth_abort(s.try_create(t));
        sign_with_transfer(&s, &s.payer, "create_and_fund", signed.args(&s.env), AMOUNT);
        assert_auth_abort(s.try_create_and_fund(t));
    }
    s.env.mock_all_auths();
    assert_eq!(s.client.escrow_count(), 0);
    assert_eq!(s.client.party_escrow_count(&evil, &PartyRole::Recipient), 0);
}

/// Arbiter signs a split of 1 to the recipient; a colluding party submits it
/// as "everything to me".
#[test]
fn resolve_signature_is_bound_to_split() {
    let s = Setup::new();
    let id = s.disputed();
    let before = s.snapshot();
    sign(&s, &s.arbiter, "resolve", (id, 1_i128).into_val(&s.env));
    assert_auth_abort(s.client.try_resolve(&id, &AMOUNT));
    sign(&s, &s.arbiter, "resolve", (id, 1_i128).into_val(&s.env));
    assert_auth_abort(s.client.try_resolve(&id, &0));
    s.env.mock_all_auths();
    assert_eq!(s.snapshot(), before);
}

/// Recipient signs `dispute(id, recipient)`; attacker rewrites `by`.
#[test]
fn dispute_signature_is_bound_to_by() {
    let s = Setup::new();
    let id = s.funded();
    sign(
        &s,
        &s.recipient,
        "dispute",
        (id, s.recipient.clone()).into_val(&s.env),
    );
    assert_auth_abort(s.client.try_dispute(&id, &s.payer));
    s.env.mock_all_auths();
    assert_eq!(s.status(id), Status::Funded);
}

/// One signed `create` authorisation must not create two escrows.
#[test]
fn one_signature_cannot_be_replayed_for_a_second_escrow() {
    let s = Setup::new();
    let t = s.terms();
    sign(&s, &s.payer, "create", t.args(&s.env));
    assert!(s.try_create(&t).is_ok());
    // Same auth set still installed; the entry was consumed.
    assert_auth_abort(s.try_create(&t));
    s.env.mock_all_auths();
    assert_eq!(s.client.escrow_count(), 1);
}

// ============================================================ 6. reentrancy

#[contracttype]
enum RKey {
    Balance(Address),
    Target,
    Outcome,
}

#[contracttype]
#[derive(Clone)]
struct ReentryTarget {
    escrow: Address,
    id: u64,
}

/// Malicious token: during its first armed `transfer` it re-enters the
/// escrow and tries to `release` another escrow, recording the outcome
/// (1 = re-entry succeeded, 2 = refused).
#[contract]
pub struct ReentrantToken;

#[contractimpl]
impl ReentrantToken {
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&RKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let b = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&RKey::Balance(to), &(b + amount));
    }

    pub fn arm(env: Env, escrow: Address, id: u64) {
        env.storage()
            .instance()
            .set(&RKey::Target, &ReentryTarget { escrow, id });
    }

    pub fn outcome(env: Env) -> u32 {
        env.storage().instance().get(&RKey::Outcome).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        let fb = Self::balance(env.clone(), from.clone());
        let tb = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&RKey::Balance(from), &(fb - amount));
        env.storage()
            .persistent()
            .set(&RKey::Balance(to), &(tb + amount));
        if let Some(t) = env
            .storage()
            .instance()
            .get::<_, ReentryTarget>(&RKey::Target)
        {
            env.storage().instance().remove(&RKey::Target);
            let r = SisonkeEscrowClient::new(&env, &t.escrow).try_release(&t.id);
            let code: u32 = if matches!(r, Ok(Ok(()))) { 1 } else { 2 };
            env.storage().instance().set(&RKey::Outcome, &code);
        }
    }
}

/// A token whose `transfer` calls back into the escrow (during both payout
/// and funding) to release a *different* escrow, with every signature
/// available including non-root ones. The host's re-entry guard must refuse
/// it; the victim escrow stays Funded and its funds stay put.
#[test]
fn reentrant_token_cannot_reenter_escrow() {
    let env = new_env();
    let evil = env.register(ReentrantToken, ());
    let s = Setup::new_in(env, None, Some(evil.clone()));
    let token = ReentrantTokenClient::new(&s.env, &evil);
    s.env.mock_all_auths_allowing_non_root_auth();

    let a = s.funded();
    let victim = s.funded();

    // Re-entry during payout (release of `a`).
    token.arm(&s.contract, &victim);
    assert_eq!(s.client.try_release(&a), Ok(Ok(())));
    assert_eq!(token.outcome(), 2, "re-entry during payout succeeded");
    assert_eq!(s.status(victim), Status::Funded);

    // Re-entry during funding (create_and_fund pulls funds through the token).
    token.arm(&s.contract, &victim);
    assert!(s.try_create_and_fund(&s.terms()).is_ok());
    assert_eq!(token.outcome(), 2, "re-entry during funding succeeded");
    assert_eq!(s.status(victim), Status::Funded);
    assert_conserved(&s);
    assert_eq!(s.status(a), Status::Released);
    assert_eq!(s.balance(&s.recipient), AMOUNT, "paid once, for `a` only");
}

// ======================================================= 7. admin/upgrade

/// Nobody but the admin can upgrade, pause, lock or start a handover; the
/// pending admin cannot act before accepting.
#[test]
fn admin_powers_cannot_be_hijacked() {
    let s = Setup::new();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    let mallory = s.stranger.clone();
    s.as_signer(
        &s.admin,
        "propose_admin",
        (s.arbiter.clone(),).into_val(&s.env),
        || s.client.propose_admin(&s.arbiter),
    );
    let before = s.snapshot();
    for who in [
        &mallory,
        &s.payer,
        &s.recipient,
        &s.arbiter, /* pending */
    ] {
        assert_auth_abort(
            s.as_signer(who, "upgrade", (hash.clone(),).into_val(&s.env), || {
                s.client.try_upgrade(&hash)
            }),
        );
        assert_auth_abort(
            s.as_signer(who, "set_paused", (true,).into_val(&s.env), || {
                s.client.try_set_paused(&true)
            }),
        );
        assert_auth_abort(s.as_signer(
            who,
            "propose_admin",
            (mallory.clone(),).into_val(&s.env),
            || s.client.try_propose_admin(&mallory),
        ));
        assert_auth_abort(s.as_signer(who, "lock_upgrades", Vec::new(&s.env), || {
            s.client.try_lock_upgrades()
        }));
        assert_auth_abort(
            s.as_signer(who, "cancel_admin_proposal", Vec::new(&s.env), || {
                s.client.try_cancel_admin_proposal()
            }),
        );
    }
    // Mallory can't accept a proposal made for someone else.
    assert_auth_abort(s.as_signer(&mallory, "accept_admin", Vec::new(&s.env), || {
        s.client.try_accept_admin()
    }));
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.client.version(), 1);
}

/// Proposal replaced or cancelled: the earlier nominee's signature is dead.
#[test]
fn stale_admin_nominee_cannot_accept() {
    let s = Setup::new();
    let first = Address::generate(&s.env);
    let second = Address::generate(&s.env);
    s.client.propose_admin(&first);
    s.client.propose_admin(&second);
    assert_auth_abort(s.as_signer(&first, "accept_admin", Vec::new(&s.env), || {
        s.client.try_accept_admin()
    }));
    s.client.cancel_admin_proposal();
    assert_eq!(
        s.as_signer(&second, "accept_admin", Vec::new(&s.env), || s
            .client
            .try_accept_admin()),
        Err(Ok(Error::NoPendingAdmin))
    );
    assert_eq!(s.client.admin(), s.admin);
}

/// `lock_upgrades` is permanent across admin handovers: the new admin can't
/// upgrade either, and the old one has lost even pause.
#[test]
fn upgrade_lock_survives_handover_and_old_admin_is_powerless() {
    let s = Setup::new();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    let new_admin = Address::generate(&s.env);
    s.client.lock_upgrades();
    s.client.propose_admin(&new_admin);
    s.as_signer(&new_admin, "accept_admin", Vec::new(&s.env), || {
        s.client.accept_admin()
    });
    assert_eq!(
        s.as_signer(
            &new_admin,
            "upgrade",
            (hash.clone(),).into_val(&s.env),
            || { s.client.try_upgrade(&hash) }
        ),
        Err(Ok(Error::UpgradesLocked))
    );
    assert_eq!(
        s.as_signer(&new_admin, "lock_upgrades", Vec::new(&s.env), || s
            .client
            .try_lock_upgrades()),
        Err(Ok(Error::UpgradesLocked))
    );
    for (f, args) in [
        ("upgrade", (hash.clone(),).into_val(&s.env)),
        ("set_paused", (true,).into_val(&s.env)),
    ] {
        let r = s.as_signer(&s.admin, f, args, || match f {
            "upgrade" => s.client.try_upgrade(&hash),
            _ => s.client.try_set_paused(&true),
        });
        assert_auth_abort(r);
    }
    assert!(!s.client.upgrades_enabled());
    assert_eq!(s.client.version(), 1);
}

/// `migrate` is permissionless; an attacker calling it (no auth at all) must
/// not change anything.
#[test]
fn migrate_by_stranger_is_inert() {
    let s = Setup::new();
    s.funded();
    s.disputed();
    let before = s.snapshot();
    s.env.mock_auths(&[]);
    for _ in 0..3 {
        assert_eq!(s.client.try_migrate(), Err(Ok(Error::NothingToMigrate)));
    }
    s.env.mock_all_auths();
    assert_eq!(s.snapshot(), before);
}

/// Admin pauses to trap funds: every way out still works, each signed only
/// by the legitimate party.
#[test]
fn pause_cannot_trap_funds() {
    let s = Setup::new();
    let release = s.funded();
    let refund = s.funded();
    let reclaim = s.funded();
    let disputed = s.funded();
    let concede = s.disputed();
    let cancel = s.create();
    s.as_signer(&s.admin, "set_paused", (true,).into_val(&s.env), || {
        s.client.set_paused(&true)
    });

    assert_eq!(s.act_as(&s.payer, &Act::Release, release), Ok(Ok(())));
    assert_eq!(s.act_as(&s.recipient, &Act::Refund, refund), Ok(Ok(())));
    assert_eq!(s.act_as(&s.payer, &Act::Cancel, cancel), Ok(Ok(())));
    assert_eq!(
        s.act_as(&s.recipient, &Act::Dispute(s.recipient.clone()), disputed),
        Ok(Ok(()))
    );
    assert_eq!(
        s.act_as(&s.arbiter, &Act::Resolve(AMOUNT / 2), disputed),
        Ok(Ok(()))
    );
    assert_eq!(s.act_as(&s.payer, &Act::Release, concede), Ok(Ok(())));
    s.set_time(DEADLINE);
    assert_eq!(s.act_as(&s.payer, &Act::Reclaim, reclaim), Ok(Ok(())));
    assert_eq!(s.client.total_locked(), 0);
    assert_eq!(s.balance(&s.contract), 0);
    assert_conserved(&s);
}

// ============================================================== 8. storage

/// Id counter at the end of u64: create refuses (143) instead of wrapping
/// to an id that would overwrite escrow #1.
#[test]
fn id_overflow_cannot_overwrite_an_existing_escrow() {
    let s = Setup::new();
    let first = s.funded();
    s.env.as_contract(&s.contract, || {
        s.env.storage().instance().set(&DataKey::NextId, &u64::MAX);
    });
    let before = s.escrow(first);
    assert_eq!(s.try_create(&s.terms()), Err(Ok(Error::Overflow)));
    assert_eq!(s.try_create_and_fund(&s.terms()), Err(Ok(Error::Overflow)));
    assert_eq!(s.escrow(first), before);
    assert_eq!(s.balance(&s.contract), AMOUNT);
}

/// Garbage ids and pages in the reads never panic or leak other data.
#[test]
fn reads_with_garbage_ids_and_pages_are_safe() {
    let s = Setup::new();
    let id = s.funded();
    let mut ids = Vec::new(&s.env);
    for x in [0, u64::MAX, id, 999, id] {
        ids.push_back(x);
    }
    let out = s.client.get_escrows(&ids);
    assert_eq!(out.len(), 2);
    assert!(out.iter().all(|v| v.escrow.id == id));
    let mut too_many = Vec::new(&s.env);
    for _ in 0..21 {
        too_many.push_back(id);
    }
    assert_eq!(
        s.client.try_get_escrows(&too_many),
        Err(Ok(Error::BatchTooLarge))
    );
    assert_eq!(s.client.try_get_escrow(&0), Err(Ok(Error::NotFound)));
    assert_eq!(s.client.try_get_escrow(&u64::MAX), Err(Ok(Error::NotFound)));
    assert!(s
        .client
        .party_escrow_ids(&s.payer, &PartyRole::Payer, &u32::MAX)
        .is_empty());
    assert_eq!(
        s.client.try_extend_escrow_ttl(&u64::MAX),
        Err(Ok(Error::NotFound))
    );
}

/// Index spam (Low, by design): a stranger can, with no signature from the
/// victim, add entries to the victim's Recipient and Arbiter index (and pick
/// any title). It costs the attacker the fees and rent; it cannot touch the
/// victim's funds, its Payer index, or its ability to transact.
#[test]
fn stranger_can_spam_victims_index_but_not_its_funds() {
    let s = Setup::new();
    let victim = s.recipient.clone();
    let real = s.funded();
    let mallory = s.stranger.clone();
    let spam = Terms {
        payer: mallory.clone(),
        recipient: victim.clone(),
        arbiter: Some(s.arbiter.clone()),
        amount: i128::MAX, // looks huge in a naive UI, never funded
        title: s.str("PAID 1,000,000 USDC - click to claim"),
        ..s.terms()
    };
    for _ in 0..60 {
        s.as_signer(&mallory, "create", spam.args(&s.env), || {
            s.create_with(&spam)
        });
    }
    assert_eq!(
        s.client.party_escrow_count(&victim, &PartyRole::Recipient),
        61
    );
    assert_eq!(
        s.client
            .party_escrow_ids(&victim, &PartyRole::Recipient, &1)
            .len(),
        11
    );
    assert_eq!(s.client.party_escrow_count(&victim, &PartyRole::Payer), 0);
    // The victim's real escrow is unaffected and still settles.
    assert_eq!(s.act_as(&s.payer, &Act::Release, real), Ok(Ok(())));
    assert_eq!(s.balance(&victim), AMOUNT);
}

// ============================================================ 9. griefing

/// Token with a revocable issuer, so tests can freeze a party's balance.
fn frozen_setup<'a>() -> Setup<'a> {
    let env = new_env();
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    Setup::new_in(env, None, Some(sac.address()))
}

fn freeze(s: &Setup, who: &Address) {
    StellarAssetClient::new(&s.env, &s.usdc.address).set_authorized(who, &false);
}

/// Recipient (or the issuer) freezes the recipient's balance so `release`
/// can never succeed. The payer must not be stuck: release reverts
/// atomically, reclaim works after the deadline, and in a dispute the
/// arbiter can still return everything to the payer.
#[test]
fn frozen_recipient_cannot_lock_payers_funds() {
    let s = frozen_setup();
    let plain = s.funded();
    let disputed = s.disputed();
    freeze(&s, &s.recipient);

    let before = s.snapshot();
    assert!(s.act_as(&s.payer, &Act::Release, plain).is_err());
    assert!(s.act_as(&s.arbiter, &Act::Resolve(1), disputed).is_err());
    assert_eq!(s.snapshot(), before, "failed payout left traces");

    assert_eq!(s.act_as(&s.arbiter, &Act::Resolve(0), disputed), Ok(Ok(())));
    s.set_time(DEADLINE);
    assert_eq!(s.act_as(&s.payer, &Act::Reclaim, plain), Ok(Ok(())));
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_conserved(&s);
}

/// Payer frozen (e.g. to sabotage a split): the recipient can still be paid
/// in full by the payer's release or the arbiter.
#[test]
fn frozen_payer_cannot_block_recipient_payout() {
    let s = frozen_setup();
    let plain = s.funded();
    let disputed = s.disputed();
    freeze(&s, &s.payer);
    assert!(s
        .act_as(&s.arbiter, &Act::Resolve(AMOUNT / 2), disputed)
        .is_err());
    assert_eq!(
        s.act_as(&s.arbiter, &Act::Resolve(AMOUNT), disputed),
        Ok(Ok(()))
    );
    assert_eq!(s.act_as(&s.payer, &Act::Release, plain), Ok(Ok(())));
    assert_eq!(s.balance(&s.recipient), 2 * AMOUNT);
    assert_conserved(&s);
}

/// Info (documented trust assumption): once a dispute is open, an absent
/// arbiter freezes the payer's money indefinitely; only a concession or the
/// arbiter can move it. The recipient can use a last-second dispute to take
/// away the payer's reclaim. Asserts the documented behaviour.
#[test]
fn absent_arbiter_after_dispute_holds_funds_until_concession() {
    let s = Setup::new();
    let id = s.funded();
    s.set_time(DEADLINE - 1);
    assert_eq!(
        s.act_as(&s.recipient, &Act::Dispute(s.recipient.clone()), id),
        Ok(Ok(()))
    );
    s.set_time(DEADLINE + 3650 * DAY);
    assert_eq!(
        s.act_as(&s.payer, &Act::Reclaim, id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(s.status(id), Status::Disputed);
    // Exits that remain: concession by either side, or the arbiter.
    assert_eq!(s.act_as(&s.recipient, &Act::Refund, id), Ok(Ok(())));
    assert_eq!(s.balance(&s.payer), PAYER_START);
}
