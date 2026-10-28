//! Input checks on `create` / `create_and_fund`, unknown ids, batch limits
//! and the constructor.

extern crate std;

use soroban_sdk::{testutils::Address as _, vec, Address, String, Vec};

use super::{new_env, Setup, Terms, AMOUNT, PAYER_START, START};
use crate::{DataKey, Error, PartyRole, SisonkeEscrow, MAX_BATCH, MAX_DURATION};

/// Runs both create paths on `t` and checks they fail the same way, leaving
/// no escrow, no index entry and no moved funds behind.
fn assert_create_fails(s: &Setup, t: &Terms, expected: Error) {
    assert_eq!(s.try_create(t), Err(Ok(expected)), "create: {t:?}");
    assert_eq!(
        s.try_create_and_fund(t),
        Err(Ok(expected)),
        "create_and_fund: {t:?}"
    );
    assert_eq!(s.client.escrow_count(), 0);
    assert_eq!(s.balance(&s.payer), PAYER_START);
    assert_eq!(s.client.party_escrow_count(&t.payer, &PartyRole::Payer), 0);
}

/// Each check fires alone, and when several are broken at once the first in
/// the documented order wins: 141, 140, 120, 121, 123, 122, 124, 125, 126,
/// 128, then 143.
#[test]
fn create_validates_inputs_in_documented_order() {
    let s = Setup::new();
    let ok = s.terms();
    let this = s.contract.clone();
    let long = s.str(&"x".repeat(65));
    let control = s.str("bad\ttitle");

    // One broken input at a time.
    let cases: std::vec::Vec<(Terms, Error)> = std::vec![
        (
            Terms {
                title: control.clone(),
                ..ok.clone()
            },
            Error::InvalidTitle
        ),
        (
            Terms {
                amount: 0,
                ..ok.clone()
            },
            Error::InvalidAmount
        ),
        (
            Terms {
                recipient: s.payer.clone(),
                arbiter: None,
                ..ok.clone()
            },
            Error::SameParty
        ),
        (
            Terms {
                recipient: this.clone(),
                ..ok.clone()
            },
            Error::InvalidParty
        ),
        (
            Terms {
                arbiter: Some(this.clone()),
                ..ok.clone()
            },
            Error::InvalidParty
        ),
        (
            Terms {
                arbiter: Some(s.payer.clone()),
                ..ok.clone()
            },
            Error::InvalidArbiter
        ),
        (
            Terms {
                arbiter: Some(s.recipient.clone()),
                ..ok.clone()
            },
            Error::InvalidArbiter
        ),
        (
            Terms {
                deadline: START,
                ..ok.clone()
            },
            Error::DeadlineInPast
        ),
        (
            Terms {
                deadline: START - 1,
                ..ok.clone()
            },
            Error::DeadlineInPast
        ),
        (
            Terms {
                deadline: START + MAX_DURATION + 1,
                ..ok.clone()
            },
            Error::DeadlineTooFar
        ),
        (
            Terms {
                title: long.clone(),
                ..ok.clone()
            },
            Error::TitleTooLong
        ),
    ];
    for (t, e) in &cases {
        assert_create_fails(&s, t, *e);
    }

    // Precedence: everything after the first broken check is also broken.
    let all_bad = |from: usize| -> Terms {
        let mut t = ok.clone();
        if from == 0 {
            t.amount = -5;
        }
        if from <= 1 {
            t.recipient = s.payer.clone();
        }
        if from <= 2 {
            t.arbiter = Some(this.clone());
        }
        if from == 3 {
            t.arbiter = Some(t.payer.clone());
        }
        if from <= 4 {
            t.deadline = START;
        }
        if from == 5 {
            t.deadline = START + MAX_DURATION + 1;
        }
        // Too long beats invalid; from 7 on only the title's bytes are bad.
        t.title = if from <= 6 {
            long.clone()
        } else {
            control.clone()
        };
        t
    };
    let order = [
        Error::InvalidAmount,
        Error::SameParty,
        Error::InvalidParty,
        Error::InvalidArbiter,
        Error::DeadlineInPast,
        Error::DeadlineTooFar,
        Error::TitleTooLong,
        Error::InvalidTitle,
    ];
    for (from, expected) in order.iter().enumerate() {
        assert_create_fails(&s, &all_bad(from), *expected);
    }

    // Pause comes before every input check; the storage guard before pause.
    s.client.set_paused(&true);
    assert_create_fails(&s, &all_bad(0), Error::Paused);
    s.env.as_contract(&s.contract, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::StorageVersion, &(crate::STORAGE_VERSION + 1));
    });
    assert_create_fails(&s, &all_bad(0), Error::MigrationRequired);
    s.env.as_contract(&s.contract, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::StorageVersion, &crate::STORAGE_VERSION);
    });
    s.client.set_paused(&false);

    // A payer equal to this contract is refused too.
    let self_payer = Terms {
        payer: this.clone(),
        ..ok.clone()
    };
    assert_eq!(s.try_create(&self_payer), Err(Ok(Error::InvalidParty)));

    // Last: the id counter cannot wrap.
    s.env.as_contract(&s.contract, || {
        s.env.storage().instance().set(&DataKey::NextId, &u64::MAX);
    });
    assert_eq!(s.try_create(&ok), Err(Ok(Error::Overflow)));
    assert_eq!(s.try_create_and_fund(&ok), Err(Ok(Error::Overflow)));
    assert_eq!(s.balance(&s.payer), PAYER_START);
}

#[test]
fn title_cap_is_inclusive_and_in_bytes() {
    let s = Setup::new();
    let with_title = |title: &str| Terms {
        title: s.str(title),
        ..s.terms()
    };
    assert!(s.try_create(&with_title(&"a".repeat(64))).is_ok());
    assert!(s.try_create(&with_title("")).is_ok());
    assert_eq!(
        s.try_create(&with_title(&"a".repeat(65))),
        Err(Ok(Error::TitleTooLong))
    );
    // "é" is 2 bytes: 32 of them are 64 bytes, 33 are 66.
    assert!(s.try_create(&with_title(&"é".repeat(32))).is_ok());
    assert_eq!(
        s.try_create(&with_title(&"é".repeat(33))),
        Err(Ok(Error::TitleTooLong))
    );
    // 22 characters, but 66 bytes.
    assert_eq!(
        s.try_create(&with_title(&"€".repeat(22))),
        Err(Ok(Error::TitleTooLong))
    );
}

#[test]
fn max_duration_is_inclusive() {
    let s = Setup::new();
    let at = |deadline: u64| Terms {
        deadline,
        ..s.terms()
    };
    let id = s.create_and_fund_with(&at(START + MAX_DURATION));
    assert_eq!(s.escrow(id).deadline, START + MAX_DURATION);
    assert_eq!(
        s.try_create(&at(START + MAX_DURATION + 1)),
        Err(Ok(Error::DeadlineTooFar))
    );
    assert_eq!(s.try_create(&at(u64::MAX)), Err(Ok(Error::DeadlineTooFar)));
    assert!(s.try_create(&at(START + 1)).is_ok());
}

#[test]
fn zero_and_negative_amounts_fail() {
    let s = Setup::new();
    for amount in [0, -1, -AMOUNT, i128::MIN] {
        let t = Terms {
            amount,
            ..s.terms()
        };
        assert_create_fails(&s, &t, Error::InvalidAmount);
    }
}

#[test]
fn unknown_id_is_not_found_for_every_function() {
    let s = Setup::new();
    s.funded();
    for id in [0, 2, u64::MAX] {
        assert_eq!(s.client.try_fund(&id), Err(Ok(Error::NotFound)));
        assert_eq!(s.client.try_cancel(&id), Err(Ok(Error::NotFound)));
        assert_eq!(s.client.try_release(&id), Err(Ok(Error::NotFound)));
        assert_eq!(s.client.try_refund(&id), Err(Ok(Error::NotFound)));
        assert_eq!(s.client.try_reclaim(&id), Err(Ok(Error::NotFound)));
        assert_eq!(
            s.client.try_dispute(&id, &s.payer),
            Err(Ok(Error::NotFound))
        );
        assert_eq!(s.client.try_resolve(&id, &0), Err(Ok(Error::NotFound)));
        assert_eq!(
            s.client.try_extend_escrow_ttl(&id),
            Err(Ok(Error::NotFound))
        );
        assert_eq!(s.client.try_get_escrow(&id), Err(Ok(Error::NotFound)));
    }
}

#[test]
fn get_escrows_rejects_oversized_batch() {
    let s = Setup::new();
    s.create();
    let mut ids: Vec<u64> = vec![&s.env];
    for _ in 0..MAX_BATCH {
        ids.push_back(1);
    }
    assert_eq!(s.client.get_escrows(&ids).len(), MAX_BATCH);
    ids.push_back(1);
    assert_eq!(
        s.client.try_get_escrows(&ids),
        Err(Ok(Error::BatchTooLarge))
    );
}

/// The constructor calls `decimals()` on the token, so deploying with an
/// address that isn't a token contract fails.
#[test]
fn constructor_rejects_non_token() {
    let not_a_contract = std::panic::catch_unwind(|| {
        let env = new_env();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        env.register(SisonkeEscrow, (&admin, &token));
    });
    assert!(not_a_contract.is_err());

    // A contract without a token interface: another escrow instance.
    let not_a_token = std::panic::catch_unwind(|| {
        let s = Setup::new();
        let admin = Address::generate(&s.env);
        s.env.register(SisonkeEscrow, (&admin, &s.contract));
    });
    assert!(not_a_token.is_err());
}

/// SIS-07: the title is valid UTF-8 with no ASCII control bytes, checked
/// after the length cap. Everything printable, including non-ASCII and
/// non-Latin text, is accepted.
#[test]
fn title_must_be_utf8_without_control_bytes() {
    let s = Setup::new();
    let with_bytes = |b: &[u8]| Terms {
        title: String::from_bytes(&s.env, b),
        ..s.terms()
    };

    for ok in [
        "Logo design",
        "Ubuntu: umuntu ngumuntu ngabantu",
        "café €5 · 日本語 · emoji 🎨",
        " ~!@#$%^&*()_+{}|:\"<>?`-=[]\\;',./",
    ] {
        let fresh = Setup::new();
        let t = Terms {
            title: fresh.str(ok),
            ..fresh.terms()
        };
        let id = fresh.create_with(&t);
        assert_eq!(fresh.escrow(id).title, t.title, "{ok:?}");
    }

    let bad: [&[u8]; 11] = [
        b"\x00",
        b"tab\there",
        b"line\nbreak",
        b"carriage\rreturn",
        b"esc\x1b[31m",
        b"del\x7f",
        b"\x1f",
        b"\xff",         // never valid UTF-8
        b"\xc3",         // truncated 2-byte sequence
        b"\xe2\x82",     // truncated 3-byte sequence
        b"\xed\xa0\x80", // UTF-16 surrogate, invalid in UTF-8
    ];
    for b in bad {
        assert_create_fails(&s, &with_bytes(b), Error::InvalidTitle);
    }
    // Overlong encoding of '/'.
    assert_create_fails(&s, &with_bytes(b"\xc0\xaf"), Error::InvalidTitle);

    // 64 bytes of a multibyte character that cuts the last one in half.
    let mut cut = "é".repeat(31).into_bytes();
    cut.extend_from_slice(b"a\xc3");
    assert_eq!(cut.len(), 64);
    assert_create_fails(&s, &with_bytes(&cut), Error::InvalidTitle);

    // The length cap comes first: 65 bytes of garbage is TitleTooLong.
    assert_create_fails(&s, &with_bytes(&[0u8; 65]), Error::TitleTooLong);
}
