//! Adversary round 2: the upgrade timelock, the admin handover around it,
//! and the fund-time counterparty index.
//!
//! Conventions as in `adversary`: `// VULN:` marks a live vulnerability whose
//! test asserts the safe behaviour (and therefore fails). `// NOTE:` marks a
//! passing test that pins down a design limit worth knowing about; it is not
//! a bug in the code as specified.

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, IntoVal, Val, Vec};

use super::{assert_auth_abort, v2, Act, Setup, Terms, AMOUNT, DEADLINE, START, UPGRADE_DELAY};
use crate::{
    storage, DataKey, Error, PartyRole, Status, MAX_UPGRADE_DELAY, PAGE_SIZE, UPGRADE_WINDOW,
    VERSION,
};

fn no_args(s: &Setup) -> Vec<Val> {
    Vec::new(&s.env)
}

fn fixture_hash(s: &Setup) -> BytesN<32> {
    s.env.deployer().upload_contract_wasm(v2::WASM)
}

fn running_v2(s: &Setup) -> bool {
    v2::Client::new(&s.env, &s.contract).version() == 2
}

fn count(s: &Setup, who: &Address, role: PartyRole) -> u32 {
    s.client.party_escrow_count(who, &role)
}

// ============================================================ the delay

/// propose → cancel → re-propose (and re-propose without cancel) never
/// yields an eta earlier than `now + delay` of the *latest* proposal.
#[test]
fn cancel_and_repropose_cannot_shorten_the_delay() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let first_eta = s.client.pending_upgrade().unwrap().eta;

    s.set_time(first_eta - 1);
    s.client.cancel_upgrade();
    s.client.propose_upgrade(&hash);
    let second = s.client.pending_upgrade().unwrap();
    assert_eq!(second.eta, first_eta - 1 + UPGRADE_DELAY);
    for now in [first_eta, second.eta - 1] {
        s.set_time(now);
        assert_eq!(
            s.client.try_upgrade(&s.pending_hash()),
            Err(Ok(Error::UpgradeTooEarly))
        );
    }
    // Same hash again: still restarts rather than keeping the older eta.
    s.client.propose_upgrade(&hash);
    assert_eq!(
        s.client.pending_upgrade().unwrap().eta,
        second.eta - 1 + UPGRADE_DELAY
    );
    assert_eq!(s.client.version(), VERSION);
}

/// `now + delay` near `u64::MAX` is refused with `Overflow`, never wrapped
/// to a small eta and never saturated.
#[test]
fn propose_near_u64_max_overflows_instead_of_wrapping() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.set_upgrade_delay(&MAX_UPGRADE_DELAY);

    s.set_time(u64::MAX - MAX_UPGRADE_DELAY + 1);
    assert_eq!(
        s.client.try_propose_upgrade(&hash),
        Err(Ok(Error::Overflow))
    );
    assert_eq!(s.client.pending_upgrade(), None);

    // Exactly at the edge eta == u64::MAX, which is still in the future.
    s.set_time(u64::MAX - MAX_UPGRADE_DELAY);
    s.client.propose_upgrade(&hash);
    assert_eq!(s.client.pending_upgrade().unwrap().eta, u64::MAX);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::UpgradeTooEarly))
    );
}

/// Raising the delay while a proposal is pending holds that proposal to the
/// new delay: its eta moves out to `proposed_at + new delay` (and its expiry
/// with it), so "propose under a short delay, then raise it" gains nothing.
/// (Was `raising_the_delay_keeps_the_pending_eta`, a NOTE; fixed.)
#[test]
fn raising_the_delay_pushes_the_pending_eta() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let before = s.client.pending_upgrade().unwrap();
    s.client.set_upgrade_delay(&MAX_UPGRADE_DELAY);
    let after = s.client.pending_upgrade().unwrap();
    assert_eq!(after.eta, before.proposed_at + MAX_UPGRADE_DELAY);
    assert_eq!(after.expires_at, after.eta + UPGRADE_WINDOW);
    assert_eq!(s.client.info().pending_upgrade_eta, Some(after.eta));

    s.set_time(before.eta);
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradeTooEarly)));
    s.set_time(after.eta);
    s.client.upgrade(&hash);
    assert!(running_v2(&s));
}

/// A matured proposal only stays executable for `UPGRADE_WINDOW` after its
/// eta; later it is refused and has to be proposed again, with a fresh
/// public delay. (Was `stale_proposal_stays_executable_for_months`, a NOTE;
/// fixed.)
#[test]
fn stale_proposal_expires_after_the_window() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let pending = s.client.pending_upgrade().unwrap();
    // 100 days with no writes at all: the instance (and the proposal in it)
    // is still live, 120-day TTL, but the proposal is dead.
    s.advance_days(100);
    assert!(s.client.pending_upgrade().is_some());
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradeExpired)));
    // Also just one second past the window.
    s.set_time(pending.expires_at + 1);
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradeExpired)));
    assert!(!running_v2(&s));
    // Re-proposing restarts the full delay.
    s.client.propose_upgrade(&hash);
    let fresh = s.client.pending_upgrade().unwrap();
    assert_eq!(fresh.eta, pending.expires_at + 1 + UPGRADE_DELAY);
    s.set_time(fresh.expires_at);
    s.client.upgrade(&hash);
    assert!(running_v2(&s));
}

/// The installed code is exactly the proposed hash: `upgrade()` takes no
/// argument, and replacing the proposal replaces what gets installed.
/// A hash with no uploaded wasm fails at `upgrade()` and the whole call
/// rolls back, so the proposal is still there and the code unchanged.
#[test]
fn upgrade_installs_only_the_pending_hash() {
    let s = Setup::new();
    let bogus = BytesN::from_array(&s.env, &[0xAB; 32]);
    s.client.propose_upgrade(&bogus);
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    assert!(s.client.try_upgrade(&s.pending_hash()).is_err());
    assert_eq!(s.client.pending_upgrade().unwrap().wasm_hash, bogus);
    assert_eq!(s.client.version(), VERSION);

    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    s.client.upgrade(&s.pending_hash());
    assert!(running_v2(&s));
}

/// NOTE: the wasm doesn't have to exist during the delay. The admin can
/// propose a bare hash, keep the code off-chain for the whole review window,
/// and upload + execute it at `eta`. Users then only have a hash to review;
/// a proposal whose wasm can't be fetched should be treated as hostile.
#[test]
fn proposed_wasm_can_stay_unpublished_until_eta() {
    let s = Setup::new();
    let hash: BytesN<32> = s
        .env
        .crypto()
        .sha256(&Bytes::from_slice(&s.env, v2::WASM))
        .into();
    s.client.propose_upgrade(&hash);
    let eta = s.client.pending_upgrade().unwrap().eta;
    s.set_time(eta);
    // Uploaded only now, in the same ledger as the upgrade.
    assert_eq!(s.env.deployer().upload_contract_wasm(v2::WASM), hash);
    s.client.upgrade(&s.pending_hash());
    assert!(running_v2(&s));
}

/// `upgrade(expected_wasm_hash)` binds every signature to the code it
/// approves: the auth tree carries the hash, and a different hash than the
/// pending one is refused. A signature for the old proposal can't install a
/// re-proposed one. (Was `upgrade_signature_is_not_bound_to_a_hash`, a NOTE;
/// fixed.)
#[test]
fn upgrade_signature_is_bound_to_the_hash() {
    let s = Setup::new();
    let reviewed = BytesN::from_array(&s.env, &[0x11; 32]);
    s.client.propose_upgrade(&reviewed);
    // The admin re-proposes something else; an approval of `reviewed`
    // doesn't carry over.
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    let signed_for_reviewed = (reviewed.clone(),).into_val(&s.env);
    assert_eq!(
        s.as_signer(&s.admin, "upgrade", signed_for_reviewed, || {
            s.client.try_upgrade(&reviewed)
        }),
        Err(Ok(Error::UpgradeHashMismatch))
    );
    // A signature over `upgrade(reviewed)` doesn't authorize `upgrade(hash)`.
    let signed_for_reviewed = (reviewed.clone(),).into_val(&s.env);
    assert_auth_abort(s.as_signer(&s.admin, "upgrade", signed_for_reviewed, || {
        s.client.try_upgrade(&hash)
    }));
    assert!(!running_v2(&s));
    s.as_signer(
        &s.admin,
        "upgrade",
        (hash.clone(),).into_val(&s.env),
        || s.client.upgrade(&hash),
    );
    assert!(running_v2(&s));
}

// ===================================================== lock and handover

/// After `lock_upgrades` nothing runs, even long past the old eta, and a
/// second lock is refused.
#[test]
fn nothing_executes_after_lock() {
    let s = Setup::new();
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let eta = s.client.pending_upgrade().unwrap().eta;
    s.client.lock_upgrades();
    s.set_time(eta + 30 * 86_400);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::UpgradesLocked))
    );
    assert_eq!(
        s.client.try_propose_upgrade(&hash),
        Err(Ok(Error::UpgradesLocked))
    );
    assert_eq!(s.client.try_lock_upgrades(), Err(Ok(Error::UpgradesLocked)));
    // cancel has nothing to cancel; the lock survives a handover.
    assert_eq!(
        s.client.try_cancel_upgrade(),
        Err(Ok(Error::NoPendingUpgrade))
    );
    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    s.client.accept_admin();
    assert_eq!(
        s.client.try_propose_upgrade(&hash),
        Err(Ok(Error::UpgradesLocked))
    );
    assert_eq!(s.client.version(), VERSION);
}

/// Handover race: the old admin proposes *after* naming the new admin, the
/// eta passes, then the new admin accepts. The old admin can no longer run
/// it (auth is now the new admin's) and the new admin finds nothing pending.
/// Before the accept, the old admin is still the admin and could run it:
/// that's its own power, not a bypass.
#[test]
fn old_admins_proposal_dies_with_the_handover() {
    let s = Setup::new();
    let old = s.admin.clone();
    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    let eta = s.client.pending_upgrade().unwrap().eta;
    s.set_time(eta + 1);

    s.as_signer(&next, "accept_admin", no_args(&s), || {
        s.client.accept_admin()
    });
    assert_eq!(s.client.pending_upgrade(), None);
    assert_auth_abort(s.as_signer(&old, "upgrade", s.upgrade_args(), || {
        s.client.try_upgrade(&s.pending_hash())
    }));
    let result = s.as_signer(&next, "upgrade", s.upgrade_args(), || {
        s.client.try_upgrade(&s.pending_hash())
    });
    assert_eq!(result, Err(Ok(Error::NoPendingUpgrade)));
    // The old admin can't cancel, re-propose or touch the delay either.
    let args = (hash.clone(),).into_val(&s.env);
    assert_auth_abort(s.as_signer(&old, "propose_upgrade", args, || {
        s.client.try_propose_upgrade(&hash)
    }));
    assert_eq!(s.client.version(), VERSION);
}

/// A pending migration (stored layout newer than this code) blocks every
/// exit, but proposing and executing a fix still works, and `lock_upgrades`
/// is refused. The only way to reach this state is an upgrade, which itself
/// went through the delay.
#[test]
fn pending_migration_blocks_exits_but_not_the_fix() {
    let s = Setup::new();
    let id = s.funded();
    s.env
        .as_contract(&s.contract, || storage::set_storage_version(&s.env, 2));
    assert_eq!(
        s.act_as(&s.payer, &Act::Release, id),
        Err(Ok(Error::MigrationRequired))
    );
    assert_eq!(
        s.client.try_lock_upgrades(),
        Err(Ok(Error::MigrationRequired))
    );
    let hash = fixture_hash(&s);
    s.client.propose_upgrade(&hash);
    s.set_time(s.client.pending_upgrade().unwrap().eta);
    s.client.upgrade(&s.pending_hash());
    assert!(running_v2(&s));
}

/// Paused and with an upgrade pending at the same time: every exit still
/// works; only inflows are refused.
#[test]
fn every_exit_works_while_paused_with_an_upgrade_pending() {
    let s = Setup::new();
    let to_release = s.funded();
    let to_refund = s.funded();
    let to_dispute = s.funded();
    let to_resolve = s.disputed();
    let to_cancel = s.create();
    let to_fund = s.create();
    let to_reclaim = s.create_and_fund_with(&Terms {
        deadline: START + 10,
        ..s.terms()
    });
    s.client.set_paused(&true);
    s.client.propose_upgrade(&fixture_hash(&s));
    let eta = s.client.pending_upgrade().unwrap().eta;

    for (who, act, id) in [
        (&s.payer, Act::Release, to_release),
        (&s.recipient, Act::Refund, to_refund),
        (&s.payer, Act::Dispute(s.payer.clone()), to_dispute),
        (&s.arbiter, Act::Resolve(1), to_resolve),
        (&s.payer, Act::Cancel, to_cancel),
    ] {
        assert_eq!(s.act_as(who, &act, id), Ok(Ok(())), "{act:?}");
    }
    assert_eq!(
        s.act_as(&s.payer, &Act::Fund, to_fund),
        Err(Ok(Error::Paused))
    );
    s.set_time(START + 10);
    assert_eq!(s.act_as(&s.payer, &Act::Reclaim, to_reclaim), Ok(Ok(())));
    assert!(s.env.ledger().timestamp() < eta);
    assert_eq!(s.client.total_locked(), AMOUNT, "only to_dispute");
}

/// NOTE: "users can exit during the delay" only holds by conceding. Before
/// its deadline (up to 365 days, against a delay of at most 30), a payer
/// who distrusts a proposal cannot get their own money back alone: `reclaim`
/// waits for the deadline and `dispute` moves nothing. Their only
/// unilateral exit is `release`, which pays the recipient. Symmetrically the
/// recipient's only exit is `refund`. Funds can always be moved out of the
/// new code's reach, but only to the other side.
#[test]
fn payer_cannot_recover_funds_alone_before_eta() {
    let s = Setup::new();
    let id = s.funded();
    let payer_before = s.balance(&s.payer);
    s.client.propose_upgrade(&fixture_hash(&s));
    let eta = s.client.pending_upgrade().unwrap().eta;
    assert!(DEADLINE > eta);

    s.set_time(eta - 1);
    assert_eq!(
        s.act_as(&s.payer, &Act::Reclaim, id),
        Err(Ok(Error::DeadlineNotReached))
    );
    assert_eq!(
        s.act_as(&s.payer, &Act::Dispute(s.payer.clone()), id),
        Ok(Ok(()))
    );
    // Disputed: still nothing the payer can do alone except pay the recipient.
    assert_eq!(
        s.act_as(&s.payer, &Act::Reclaim, id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(s.balance(&s.payer), payer_before);
    assert_eq!(s.status(id), Status::Disputed);
}

// ===================================================== stored-state hazards

/// Operational hazard, now fail-safe: an instance whose `UpgradeDelay` key is
/// missing (one deployed from the previous code and upgraded in place, which
/// the docs forbid) falls back to the strictest delay, `MAX_UPGRADE_DELAY`,
/// instead of trapping. Proposing, raising the delay and `info` keep working.
/// (Was `missing_upgrade_delay_key_bricks_upgrades`; fixed.)
#[test]
fn missing_upgrade_delay_key_falls_back_to_the_max_delay() {
    let s = Setup::new();
    s.env.as_contract(&s.contract, || {
        s.env.storage().instance().remove(&DataKey::UpgradeDelay)
    });
    assert_eq!(s.client.upgrade_delay(), MAX_UPGRADE_DELAY);
    assert_eq!(s.client.info().upgrade_delay, MAX_UPGRADE_DELAY);
    let hash = BytesN::from_array(&s.env, &[1; 32]);
    s.client.propose_upgrade(&hash);
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(pending.eta, pending.proposed_at + MAX_UPGRADE_DELAY);
    // Raising "to" the max is not a decrease; nothing lower is accepted.
    s.client.set_upgrade_delay(&MAX_UPGRADE_DELAY);
    assert_eq!(
        s.client.try_set_upgrade_delay(&UPGRADE_DELAY),
        Err(Ok(Error::UpgradeDelayDecrease))
    );
    // Escrows themselves still work.
    let id = s.funded();
    s.client.release(&id);
}

/// NOTE (same hazard, index side): the previous code indexed the recipient
/// and arbiter at `create`; this code does it at `fund`. An escrow created
/// under the old code and funded after an in-place upgrade is indexed
/// twice for its recipient and arbiter. Simulated by writing the old
/// create-time entries by hand.
#[test]
fn escrow_indexed_by_old_code_gets_duplicated_on_fund() {
    let s = Setup::new();
    let id = s.create();
    s.env.as_contract(&s.contract, || {
        storage::index_push(&s.env, &s.recipient, PartyRole::Recipient, id).unwrap();
        storage::index_push(&s.env, &s.arbiter, PartyRole::Arbiter, id).unwrap();
    });
    s.client.fund(&id);
    let page = s
        .client
        .party_escrow_ids(&s.recipient, &PartyRole::Recipient, &0);
    assert_eq!(page.len(), 2);
    assert_eq!((page.get(0), page.get(1)), (Some(id), Some(id)));
}

// ================================================== index-on-fund

/// Every path that funds indexes the counterparties exactly once; refused
/// or rolled-back funding indexes nothing; unfunded and cancelled escrows
/// never reach the counterparties' lists.
#[test]
fn counterparties_indexed_exactly_once_per_funded_escrow() {
    let s = Setup::new();
    let r = PartyRole::Recipient;
    let a = PartyRole::Arbiter;

    // create → fund, then a second fund is refused and adds nothing.
    let one = s.create();
    assert_eq!(
        (count(&s, &s.recipient, r), count(&s, &s.arbiter, a)),
        (0, 0)
    );
    s.client.fund(&one);
    assert_eq!(s.client.try_fund(&one), Err(Ok(Error::InvalidStatus)));
    assert_eq!(
        (count(&s, &s.recipient, r), count(&s, &s.arbiter, a)),
        (1, 1)
    );

    // create_and_fund indexes once.
    let two = s.funded();
    assert_eq!(
        (count(&s, &s.recipient, r), count(&s, &s.arbiter, a)),
        (2, 2)
    );

    // Cancelled, and created-then-expired: payer only.
    let cancelled = s.create();
    s.client.cancel(&cancelled);
    assert_eq!(s.client.try_fund(&cancelled), Err(Ok(Error::InvalidStatus)));

    // No arbiter: nobody's arbiter list moves.
    let no_arb = s.create_and_fund_with(&s.terms_no_arbiter());
    assert_eq!(
        (count(&s, &s.recipient, r), count(&s, &s.arbiter, a)),
        (3, 2)
    );

    // Funding that fails in the transfer rolls the index back with it.
    let too_big = s.create_with(&Terms {
        amount: s.balance(&s.payer) + 1,
        ..s.terms()
    });
    assert!(s.client.try_fund(&too_big).is_err());
    // Paused funding writes nothing either.
    let paused = s.create();
    s.client.set_paused(&true);
    assert_eq!(s.client.try_fund(&paused), Err(Ok(Error::Paused)));
    s.client.set_paused(&false);
    // Past the deadline: refused.
    let late = s.create_with(&Terms {
        deadline: START + 5,
        ..s.terms()
    });
    s.set_time(START + 5);
    assert_eq!(s.client.try_fund(&late), Err(Ok(Error::DeadlinePassed)));

    assert_eq!(
        (count(&s, &s.recipient, r), count(&s, &s.arbiter, a)),
        (3, 2)
    );
    let ids = s.client.party_escrow_ids(&s.recipient, &r, &0);
    assert_eq!(ids, Vec::from_array(&s.env, [one, two, no_arb]));
    assert_eq!(
        s.client.party_escrow_ids(&s.arbiter, &a, &0),
        Vec::from_array(&s.env, [one, two])
    );
    assert_eq!(count(&s, &s.payer, PartyRole::Payer), 7);
}

/// Counterparty lists are in funding order, not id order, and page at
/// exactly `PAGE_SIZE`.
#[test]
fn counterparty_pages_follow_funding_order_and_split_at_page_size() {
    let s = Setup::new();
    let r = PartyRole::Recipient;
    let tiny = Terms {
        amount: 1,
        ..s.terms()
    };
    let first = s.create_with(&tiny);
    let second = s.create_with(&tiny);
    s.client.fund(&second);
    s.client.fund(&first);
    for _ in 2..PAGE_SIZE + 1 {
        s.create_and_fund_with(&tiny);
    }
    assert_eq!(count(&s, &s.recipient, r), PAGE_SIZE + 1);
    let page0 = s.client.party_escrow_ids(&s.recipient, &r, &0);
    let page1 = s.client.party_escrow_ids(&s.recipient, &r, &1);
    assert_eq!(page0.len(), PAGE_SIZE);
    assert_eq!((page0.get(0), page0.get(1)), (Some(second), Some(first)));
    assert_eq!(page1.len(), 1);
    assert_eq!(page1.get(0), Some(PAGE_SIZE as u64 + 1));
    assert_eq!(s.client.party_escrow_ids(&s.recipient, &r, &2).len(), 0);
}

/// NOTE: indexing at fund time keeps *unfunded* spam out of a victim's
/// lists, but funded spam costs one stroop for one second: fund 1 unit with
/// a deadline of now + 1, reclaim it a second later. The attacker ends with
/// every token back and the victim's recipient and arbiter lists grow by
/// one entry per round, forever (only fees are spent).
#[test]
fn funded_spam_fills_a_victims_lists_for_free() {
    let s = Setup::new();
    let attacker = s.stranger.clone();
    s.usdc_admin.mint(&attacker, &1);
    let rounds = 5u32;
    for _ in 0..rounds {
        let now = s.env.ledger().timestamp();
        let id = s.create_and_fund_with(&Terms {
            payer: attacker.clone(),
            recipient: s.recipient.clone(),
            arbiter: Some(s.arbiter.clone()),
            amount: 1,
            deadline: now + 1,
            title: s.str(""),
            terms_hash: None,
        });
        s.set_time(now + 1);
        s.client.reclaim(&id);
    }
    assert_eq!(s.balance(&attacker), 1);
    assert_eq!(count(&s, &s.recipient, PartyRole::Recipient), rounds);
    assert_eq!(count(&s, &s.arbiter, PartyRole::Arbiter), rounds);
}
