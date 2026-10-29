//! Exact event shapes (docs/PLAN.md §6). Each successful write emits exactly
//! the listed events; failed calls emit none.

extern crate std;

use soroban_sdk::{testutils::Address as _, xdr, Address, Event, IntoVal, Symbol, TryFromVal, Val};

use super::{v2, Setup, AMOUNT, DEADLINE};
use crate::{events, Status, VERSION};

/// I17-style check, one event per transition, compared field by field.
#[test]
fn every_transition_emits_exact_event() {
    let s = Setup::new();
    let c = &s.contract;
    let t = s.terms();

    let a = s.create_with(&t);
    assert_eq!(
        s.events(),
        [events::Created {
            id: a,
            payer: t.payer.clone(),
            recipient: t.recipient.clone(),
            arbiter: t.arbiter.clone(),
            token: s.usdc.address.clone(),
            amount: t.amount,
            deadline: t.deadline,
            title: t.title.clone(),
            terms_hash: t.terms_hash.clone(),
        }
        .to_xdr(&s.env, c)]
    );

    s.client.fund(&a);
    assert_eq!(
        s.events(),
        [events::Funded {
            id: a,
            payer: s.payer.clone(),
            amount: AMOUNT,
        }
        .to_xdr(&s.env, c)]
    );

    s.client.release(&a);
    assert_eq!(
        s.events(),
        [events::Released {
            id: a,
            by: s.payer.clone(),
            recipient: s.recipient.clone(),
            amount: AMOUNT,
        }
        .to_xdr(&s.env, c)]
    );

    let b = s.funded();
    s.client.refund(&b);
    assert_eq!(
        s.events(),
        [events::Refunded {
            id: b,
            by: s.recipient.clone(),
            payer: s.payer.clone(),
            amount: AMOUNT,
        }
        .to_xdr(&s.env, c)]
    );

    let d = s.funded();
    s.client.dispute(&d, &s.recipient);
    assert_eq!(
        s.events(),
        [events::Disputed {
            id: d,
            by: s.recipient.clone(),
        }
        .to_xdr(&s.env, c)]
    );

    s.client.resolve(&d, &(AMOUNT / 4));
    assert_eq!(
        s.events(),
        [events::Resolved {
            id: d,
            arbiter: s.arbiter.clone(),
            recipient_amount: AMOUNT / 4,
            payer_amount: AMOUNT - AMOUNT / 4,
            status: Status::Split,
        }
        .to_xdr(&s.env, c)]
    );

    let e = s.create();
    s.client.cancel(&e);
    assert_eq!(
        s.events(),
        [events::Cancelled {
            id: e,
            payer: s.payer.clone(),
        }
        .to_xdr(&s.env, c)]
    );

    let f = s.funded();
    s.set_time(DEADLINE);
    s.client.reclaim(&f);
    assert_eq!(
        s.events(),
        [events::Reclaimed {
            id: f,
            payer: s.payer.clone(),
            amount: AMOUNT,
        }
        .to_xdr(&s.env, c)]
    );

    // The TTL bumps emit nothing.
    s.client.extend_escrow_ttl(&f);
    assert!(s.events().events().is_empty());
    s.client
        .extend_index_ttl(&s.payer, &crate::PartyRole::Payer, &0);
    assert!(s.events().events().is_empty());

    // Admin events.
    s.client.set_paused(&true);
    assert_eq!(
        s.events(),
        [events::Paused { paused: true }.to_xdr(&s.env, c)]
    );

    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    assert_eq!(
        s.events(),
        [events::AdminProposed {
            new_admin: next.clone(),
        }
        .to_xdr(&s.env, c)]
    );

    s.client.cancel_admin_proposal();
    assert_eq!(
        s.events(),
        [events::AdminProposalCancelled {}.to_xdr(&s.env, c)]
    );

    s.client.propose_admin(&next);
    s.client.accept_admin();
    assert_eq!(
        s.events(),
        [events::AdminChanged {
            new_admin: next.clone(),
            previous_admin: s.admin.clone(),
        }
        .to_xdr(&s.env, c)]
    );

    s.client.lock_upgrades();
    assert_eq!(s.events(), [events::UpgradesLocked {}.to_xdr(&s.env, c)]);

    // `upgraded` replaces the code, so it runs on a second instance, which
    // then shows the `migrated` shape a v2 emits.
    let s = Setup::new();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    s.upgrade_to(&hash);
    assert_eq!(
        s.events(),
        [events::Upgraded {
            new_wasm_hash: hash,
            from_version: VERSION,
        }
        .to_xdr(&s.env, &s.contract)]
    );
    v2::Client::new(&s.env, &s.contract).migrate();
    assert_eq!(
        s.events(),
        [events::Migrated { from: 1, to: 2 }.to_xdr(&s.env, &s.contract)]
    );
}

#[test]
fn create_and_fund_emits_created_then_funded() {
    let s = Setup::new();
    let t = s.terms_no_arbiter();
    let id = s.create_and_fund_with(&t);
    assert_eq!(
        s.events(),
        [
            events::Created {
                id,
                payer: t.payer.clone(),
                recipient: t.recipient.clone(),
                arbiter: None,
                token: s.usdc.address.clone(),
                amount: t.amount,
                deadline: t.deadline,
                title: t.title.clone(),
                terms_hash: t.terms_hash.clone(),
            }
            .to_xdr(&s.env, &s.contract),
            events::Funded {
                id,
                payer: t.payer.clone(),
                amount: t.amount,
            }
            .to_xdr(&s.env, &s.contract),
        ]
    );
}

/// Raw topics: `("sisonke", <function name>, id: u64)`, so one escrow's
/// history is one `getEvents` filter.
#[test]
fn escrow_event_topics_are_prefix_action_id() {
    let s = Setup::new();
    let raw_topics = |s: &Setup| -> std::vec::Vec<std::vec::Vec<xdr::ScVal>> {
        s.events()
            .events()
            .iter()
            .map(|e| {
                let xdr::ContractEventBody::V0(body) = &e.body;
                body.topics.to_vec()
            })
            .collect()
    };
    let expected = |action: &str, id: u64| -> std::vec::Vec<xdr::ScVal> {
        let topics: soroban_sdk::Vec<Val> = (
            Symbol::new(&s.env, "sisonke"),
            Symbol::new(&s.env, action),
            id,
        )
            .into_val(&s.env);
        topics
            .iter()
            .map(|v| xdr::ScVal::try_from_val(&s.env, &v).unwrap())
            .collect()
    };
    let id = s.funded();
    assert_eq!(
        raw_topics(&s),
        [expected("created", id), expected("funded", id)]
    );
    s.client.dispute(&id, &s.payer);
    assert_eq!(raw_topics(&s), [expected("disputed", id)]);
    s.client.resolve(&id, &0);
    assert_eq!(raw_topics(&s), [expected("resolved", id)]);

    let id = s.create();
    assert_eq!(raw_topics(&s), [expected("created", id)]);
    s.client.cancel(&id);
    assert_eq!(raw_topics(&s), [expected("cancelled", id)]);

    let id = s.funded();
    s.client.release(&id);
    assert_eq!(raw_topics(&s), [expected("released", id)]);
    let id = s.funded();
    s.client.refund(&id);
    assert_eq!(raw_topics(&s), [expected("refunded", id)]);
    let id = s.funded();
    s.set_time(DEADLINE);
    s.client.reclaim(&id);
    assert_eq!(raw_topics(&s), [expected("reclaimed", id)]);
    assert_eq!(s.event_names(), [("reclaimed".into(), Some(id))]);
}

/// An indexer can rebuild every term of an escrow from `created` alone.
#[test]
fn created_event_carries_all_terms() {
    let s = Setup::new();
    let bare = super::Terms {
        arbiter: None,
        terms_hash: None,
        title: s.str(""),
        ..s.terms()
    };
    for t in [s.terms(), bare] {
        let id = s.create_with(&t);
        let event = s.events();
        let e = s.escrow(id);
        assert_eq!(
            event,
            [events::Created {
                id,
                payer: e.payer,
                recipient: e.recipient,
                arbiter: e.arbiter,
                token: e.token,
                amount: e.amount,
                deadline: e.deadline,
                title: e.title,
                terms_hash: e.terms_hash,
            }
            .to_xdr(&s.env, &s.contract)]
        );
    }
}

#[test]
fn failed_calls_emit_no_events() {
    let s = Setup::new();
    let id = s.funded();
    let bad = super::Terms {
        amount: 0,
        ..s.terms()
    };
    assert!(s.try_create(&bad).is_err());
    assert!(s.events().events().is_empty());
    assert!(s.try_create_and_fund(&bad).is_err());
    assert!(s.events().events().is_empty());
    assert!(s.client.try_fund(&id).is_err());
    assert!(s.events().events().is_empty());
    assert!(s.client.try_reclaim(&id).is_err());
    assert!(s.events().events().is_empty());
    assert!(s.client.try_resolve(&id, &0).is_err());
    assert!(s.events().events().is_empty());
    assert!(s.client.try_cancel_admin_proposal().is_err());
    assert!(s.events().events().is_empty());
    s.client.release(&id);
    assert!(s.client.try_release(&id).is_err());
    assert!(s.events().events().is_empty());
    assert!(s.client.try_migrate().is_err());
    assert!(s.events().events().is_empty());
    // An auth failure emits nothing either.
    let result = s.act_as(&s.stranger, &super::Act::Refund, id);
    assert!(result.is_err());
    assert!(s.events().events().is_empty());
}

#[test]
fn constructor_emits_init() {
    let s = Setup::new();
    assert_eq!(
        s.events(),
        [events::Init {
            admin: s.admin.clone(),
            token: s.usdc.address.clone(),
            version: VERSION,
            upgrade_delay: super::UPGRADE_DELAY,
        }
        .to_xdr(&s.env, &s.contract)]
    );
    assert_eq!(s.event_names(), [("init".into(), None)]);
}
