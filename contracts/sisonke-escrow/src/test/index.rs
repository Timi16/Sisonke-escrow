//! The paged party index (I13) and batch reads.

extern crate std;

use soroban_sdk::{testutils::Address as _, vec, Address, Vec};

use super::{Setup, Terms, AMOUNT};
use crate::{PartyRole, PAGE_SIZE};

/// Every id in `party`'s index for `role`, across all pages, checking that
/// no page is over `PAGE_SIZE` and the count matches.
fn all_ids(s: &Setup, party: &Address, role: PartyRole) -> std::vec::Vec<u64> {
    let count = s.client.party_escrow_count(party, &role);
    let mut out = std::vec::Vec::new();
    let mut page = 0;
    loop {
        let ids = s.client.party_escrow_ids(party, &role, &page);
        assert!(ids.len() <= PAGE_SIZE);
        if ids.is_empty() {
            break;
        }
        out.extend(ids.iter());
        page += 1;
    }
    assert_eq!(out.len() as u32, count);
    out
}

/// The payer's index lists an escrow from creation; the recipient's and the
/// arbiter's only once it is funded, in funding order.
#[test]
fn index_records_payer_recipient_and_arbiter() {
    let s = Setup::new();
    let a = s.create();
    assert_eq!(all_ids(&s, &s.payer, PartyRole::Payer), [a]);
    assert!(all_ids(&s, &s.recipient, PartyRole::Recipient).is_empty());
    assert!(all_ids(&s, &s.arbiter, PartyRole::Arbiter).is_empty());

    let b = s.create();
    let c = s.funded();
    s.client.fund(&b);
    s.client.fund(&a);
    assert_eq!(all_ids(&s, &s.payer, PartyRole::Payer), [a, b, c]);
    assert_eq!(all_ids(&s, &s.recipient, PartyRole::Recipient), [c, b, a]);
    assert_eq!(all_ids(&s, &s.arbiter, PartyRole::Arbiter), [c, b, a]);
    // Each role is its own list.
    assert!(all_ids(&s, &s.payer, PartyRole::Recipient).is_empty());
    assert!(all_ids(&s, &s.recipient, PartyRole::Payer).is_empty());
    assert!(all_ids(&s, &s.arbiter, PartyRole::Payer).is_empty());

    // The recipient of one escrow can be the payer of another.
    s.usdc_admin.mint(&s.recipient, &AMOUNT);
    let d = s.create_with(&Terms {
        payer: s.recipient.clone(),
        recipient: s.payer.clone(),
        arbiter: None,
        ..s.terms()
    });
    assert_eq!(all_ids(&s, &s.recipient, PartyRole::Payer), [d]);
    assert!(all_ids(&s, &s.payer, PartyRole::Recipient).is_empty());
    s.client.fund(&d);
    assert_eq!(all_ids(&s, &s.payer, PartyRole::Recipient), [d]);
    assert_eq!(all_ids(&s, &s.arbiter, PartyRole::Arbiter), [c, b, a]);

    // Cancelled before funding: it never reaches the other parties' lists.
    let e = s.create();
    s.client.cancel(&e);
    assert_eq!(all_ids(&s, &s.payer, PartyRole::Payer), [a, b, c, e]);
    assert_eq!(all_ids(&s, &s.recipient, PartyRole::Recipient), [c, b, a]);
}

#[test]
fn no_arbiter_means_no_arbiter_entry() {
    let s = Setup::new();
    let id = s.create_and_fund_with(&s.terms_no_arbiter());
    assert_eq!(
        s.client.party_escrow_count(&s.arbiter, &PartyRole::Arbiter),
        0
    );
    assert_eq!(all_ids(&s, &s.payer, PartyRole::Payer), [id]);
    assert_eq!(all_ids(&s, &s.recipient, PartyRole::Recipient), [id]);
}

#[test]
fn index_page_rolls_over_at_page_size() {
    let s = Setup::new();
    let n = PAGE_SIZE as u64 + 1;
    let small = Terms {
        amount: 1,
        ..s.terms()
    };
    for _ in 0..n {
        s.create_and_fund_with(&small);
    }
    assert_eq!(s.client.party_escrow_count(&s.payer, &PartyRole::Payer), 51);
    let page0 = s.client.party_escrow_ids(&s.payer, &PartyRole::Payer, &0);
    let page1 = s.client.party_escrow_ids(&s.payer, &PartyRole::Payer, &1);
    assert_eq!(page0.len(), 50);
    assert_eq!(page1, vec![&s.env, 51]);
    let expected: std::vec::Vec<u64> = (1..=n).collect();
    for (who, role) in [
        (&s.payer, PartyRole::Payer),
        (&s.recipient, PartyRole::Recipient),
        (&s.arbiter, PartyRole::Arbiter),
    ] {
        assert_eq!(all_ids(&s, who, role), expected, "{role:?}, oldest first");
    }
}

#[test]
fn page_past_end_is_empty() {
    let s = Setup::new();
    let nobody = Address::generate(&s.env);
    assert!(s
        .client
        .party_escrow_ids(&nobody, &PartyRole::Payer, &0)
        .is_empty());
    s.create();
    assert_eq!(
        s.client.party_escrow_ids(&s.payer, &PartyRole::Payer, &0),
        vec![&s.env, 1]
    );
    for page in [1, 2, u32::MAX] {
        assert!(s
            .client
            .party_escrow_ids(&s.payer, &PartyRole::Payer, &page)
            .is_empty());
    }
}

#[test]
fn get_escrows_preserves_order_and_skips_unknown() {
    let s = Setup::new();
    let (a, b, c) = (s.create(), s.funded(), s.create());
    let ids: Vec<u64> = vec![&s.env, c, 99, a, 0, b, a];
    let views = s.client.get_escrows(&ids);
    let got: std::vec::Vec<u64> = views.iter().map(|v| v.escrow.id).collect();
    assert_eq!(got, [c, a, b, a]);
    assert_eq!(views.get(2).unwrap().escrow, s.escrow(b));
    assert!(s.client.get_escrows(&vec![&s.env]).is_empty());
}

/// Unfunded spam naming a victim never reaches the victim's lists. Funded
/// "spam" does (the spammer pays for every escrow), but only the victim's
/// list for that role grows, one bounded page at a time, and the victim's own
/// calls stay O(1).
#[test]
fn spam_escrows_do_not_touch_other_parties_index() {
    let s = Setup::new();
    let victim = Address::generate(&s.env);
    let spammer = Address::generate(&s.env);
    s.usdc_admin.mint(&spammer, &(10 * AMOUNT));
    let spam = Terms {
        payer: spammer.clone(),
        recipient: victim.clone(),
        arbiter: Some(victim.clone()),
        ..s.terms()
    };

    // Unfunded: listed for the spammer only.
    let unfunded = Terms {
        arbiter: Some(s.arbiter.clone()),
        ..spam.clone()
    };
    for _ in 0..(2 * PAGE_SIZE + 10) {
        s.create_with(&unfunded);
    }
    assert_eq!(
        s.client.party_escrow_count(&victim, &PartyRole::Recipient),
        0
    );
    assert_eq!(
        s.client.party_escrow_count(&s.arbiter, &PartyRole::Arbiter),
        0
    );
    assert_eq!(
        s.client.party_escrow_count(&spammer, &PartyRole::Payer),
        2 * PAGE_SIZE + 10
    );

    // Baseline: what a funding create naming a fresh recipient writes.
    let mut fresh = s.terms();
    fresh.amount = 1;
    fresh.payer = Address::generate(&s.env);
    s.usdc_admin.mint(&fresh.payer, &10);
    s.create_and_fund_with(&fresh);
    let baseline = s.env.cost_estimate().resources();

    // Funded spam, 1 unit each.
    let funded = Terms {
        amount: 1,
        arbiter: None,
        ..spam
    };
    for _ in 0..(2 * PAGE_SIZE + 10) {
        s.create_and_fund_with(&funded);
    }
    assert_eq!(
        s.client.party_escrow_count(&victim, &PartyRole::Recipient),
        110
    );
    assert_eq!(
        s.client
            .party_escrow_ids(&victim, &PartyRole::Recipient, &2)
            .len(),
        10
    );
    // Untouched: the victim's other roles and every other party.
    assert_eq!(s.client.party_escrow_count(&victim, &PartyRole::Payer), 0);
    assert_eq!(s.client.party_escrow_count(&s.payer, &PartyRole::Payer), 0);
    assert_eq!(
        s.client
            .party_escrow_count(&s.recipient, &PartyRole::Recipient),
        1
    );

    // A funding create naming the spammed victim writes no more entries, and
    // no more bytes, than one naming a fresh party.
    let id = s.create_and_fund_with(&Terms {
        payer: fresh.payer.clone(),
        recipient: victim.clone(),
        ..fresh.clone()
    });
    let after_spam = s.env.cost_estimate().resources();
    assert_eq!(after_spam.write_entries, baseline.write_entries);
    assert!(
        after_spam.write_bytes <= baseline.write_bytes + 16 * PAGE_SIZE,
        "{} vs {}",
        after_spam.write_bytes,
        baseline.write_bytes
    );
    assert_eq!(
        s.client
            .party_escrow_ids(&victim, &PartyRole::Recipient, &2)
            .last(),
        Some(id)
    );
}
