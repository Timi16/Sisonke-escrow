//! Upgrades (UUPS-style) of the natively registered contract to the
//! committed fixture wasm. Rollbacks need the compiled v1, so they live in
//! `wasm.rs`.

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, BytesN, Event, IntoVal, Val, Vec};

use super::{assert_auth_abort, v2, wasm_meta, Act, Setup, AMOUNT};
use crate::{DataKey, Error, PartyRole, Status, STORAGE_VERSION, VERSION};

fn set_storage_version(s: &Setup, version: u32) {
    s.env.as_contract(&s.contract, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::StorageVersion, &version);
    });
}

#[test]
fn version_and_storage_version_start_at_one() {
    let s = Setup::new();
    assert_eq!(s.client.version(), 1);
    assert_eq!(VERSION, 1);
    assert_eq!(s.client.storage_version(), 1);
    assert_eq!(STORAGE_VERSION, 1);
    assert!(s.client.upgrades_enabled());
    let info = s.client.info();
    assert_eq!((info.version, info.storage_version), (1, 1));
    assert!(!info.upgrades_locked);
}

/// I16: same address, new code, old storage, same funds.
#[test]
fn admin_upgrade_preserves_address_storage_and_funds() {
    let s = Setup::new();
    let created = s.create();
    let funded = s.funded();
    let disputed = s.disputed();
    let before = s.snapshot();

    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    let args = (hash.clone(),).into_val(&s.env);
    s.as_signer(&s.admin, "upgrade", args, || s.client.upgrade(&hash));

    let upgraded = v2::Client::new(&s.env, &s.contract);
    assert_eq!(upgraded.version(), 2);
    assert_eq!(upgraded.storage_version(), 1, "not migrated yet");
    assert_eq!(upgraded.escrow_count(), 3);
    assert_eq!(upgraded.total_locked(), 2 * AMOUNT);
    assert_eq!(upgraded.total_locked(), before.total_locked);
    assert_eq!(upgraded.admin(), s.admin);
    assert_eq!(upgraded.pending_admin(), before.info.pending_admin);
    assert_eq!(upgraded.token(), s.usdc.address);
    assert!(!upgraded.is_paused());
    // Every DataKey decodes through the fixture's copied types, the party
    // index included (PartyRole names are part of those keys).
    for (who, role, v2_role) in [
        (&s.payer, PartyRole::Payer, v2::PartyRole::Payer),
        (&s.recipient, PartyRole::Recipient, v2::PartyRole::Recipient),
        (&s.arbiter, PartyRole::Arbiter, v2::PartyRole::Arbiter),
    ] {
        let ids: std::vec::Vec<u64> = upgraded
            .party_escrow_ids(who, &v2_role, &0)
            .iter()
            .collect();
        assert_eq!(ids, [created, funded, disputed], "{role:?}");
        assert_eq!(upgraded.party_escrow_count(who, &v2_role), 3);
    }
    assert_eq!(s.balance(&s.contract), 2 * AMOUNT);
    assert_eq!(s.balances(), before.balances);

    // The fixture decodes every stored escrow with its copied types.
    for (id, status) in [
        (created, v2::Status::Created),
        (funded, v2::Status::Funded),
        (disputed, v2::Status::Disputed),
    ] {
        let old = &before.escrows[id as usize - 1];
        let raw = upgraded.get_escrow(&id);
        assert_eq!(raw.status, status);
        assert_eq!(raw.id, old.id);
        assert_eq!(raw.payer, old.payer);
        assert_eq!(raw.recipient, old.recipient);
        assert_eq!(raw.arbiter, old.arbiter);
        assert_eq!(raw.amount, old.amount);
        assert_eq!(raw.deadline, old.deadline);
        assert_eq!(raw.title, old.title);
        assert_eq!(raw.terms_hash, old.terms_hash);
        assert_eq!(raw.disputed_by, old.disputed_by);
        assert_eq!(raw.funded_at, old.funded_at);
    }
}

#[test]
fn upgrade_emits_upgraded_event() {
    let s = Setup::new();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    s.client.upgrade(&hash);
    assert_eq!(s.event_names(), [("upgraded".into(), None)]);
    assert_eq!(
        s.events(),
        [crate::events::Upgraded {
            new_wasm_hash: hash,
            from_version: VERSION,
        }
        .to_xdr(&s.env, &s.contract)]
    );
}

#[test]
fn only_admin_can_upgrade() {
    let s = Setup::new();
    let id = s.funded();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    for who in [&s.payer, &s.recipient, &s.arbiter, &s.stranger] {
        let args = (hash.clone(),).into_val(&s.env);
        assert_auth_abort(s.as_signer(who, "upgrade", args, || s.client.try_upgrade(&hash)));
    }
    assert_eq!(s.client.version(), VERSION);
    assert_eq!(s.status(id), Status::Funded);
}

/// The host refuses a hash with no uploaded wasm, and nothing changes.
#[test]
fn upgrade_to_unknown_hash_fails() {
    let s = Setup::new();
    let id = s.funded();
    let unknown = BytesN::from_array(&s.env, &[0xab; 32]);
    let result = s.client.try_upgrade(&unknown);
    assert!(matches!(result, Err(Err(_))), "{result:?}");
    assert!(s.events().events().is_empty());
    assert_eq!(s.client.version(), VERSION);
    s.client.release(&id);
    assert_eq!(s.status(id), Status::Released);
}

/// After `lock_upgrades` nobody can change the code again, not even a new
/// admin, while escrows keep working.
#[test]
fn lock_upgrades_is_permanent_across_handover() {
    let s = Setup::new();
    let id = s.funded();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    let no_args = Vec::<Val>::new(&s.env);

    s.as_signer(&s.admin, "lock_upgrades", no_args.clone(), || {
        s.client.lock_upgrades()
    });
    assert!(!s.client.upgrades_enabled());
    assert!(s.client.info().upgrades_locked);
    assert_eq!(s.client.try_upgrade(&hash), Err(Ok(Error::UpgradesLocked)));

    let next = Address::generate(&s.env);
    s.client.propose_admin(&next);
    s.client.accept_admin();
    let args = (hash.clone(),).into_val(&s.env);
    let result = s.as_signer(&next, "upgrade", args, || s.client.try_upgrade(&hash));
    assert_eq!(result, Err(Ok(Error::UpgradesLocked)));
    assert_eq!(s.client.version(), VERSION);
    assert!(!s.client.upgrades_enabled());

    s.client.release(&id);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
}

#[test]
fn lock_upgrades_twice_fails() {
    let s = Setup::new();
    s.client.lock_upgrades();
    assert_eq!(s.client.try_lock_upgrades(), Err(Ok(Error::UpgradesLocked)));
}

#[test]
fn v1_migrate_returns_nothing_to_migrate() {
    let s = Setup::new();
    // Permissionless: no auth at all.
    s.env.mock_auths(&[]);
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::NothingToMigrate)));
    s.env.mock_all_auths();
    assert_eq!(s.client.storage_version(), 1);
    // Data from a newer layout (after a rollback) is refused, not migrated.
    set_storage_version(&s, 2);
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::MigrationRequired)));
}

/// I18: with the stored layout not matching the code, every escrow write and
/// `lock_upgrades` refuse with 141; reads and the other admin calls work.
#[test]
fn writes_blocked_on_storage_version_mismatch() {
    let s = Setup::new();
    let created = s.create();
    let funded = s.funded();
    let disputed = s.disputed();
    set_storage_version(&s, 2);
    let before = s.snapshot();

    let t = s.terms();
    assert_eq!(s.try_create(&t), Err(Ok(Error::MigrationRequired)));
    assert_eq!(s.try_create_and_fund(&t), Err(Ok(Error::MigrationRequired)));
    for (act, id) in [
        (Act::Fund, created),
        (Act::Cancel, created),
        (Act::Release, funded),
        (Act::Refund, funded),
        (Act::Reclaim, funded),
        (Act::Dispute(s.payer.clone()), funded),
        (Act::Resolve(0), disputed),
        (Act::Release, disputed),
    ] {
        assert_eq!(
            s.try_act(&act, id),
            Err(Ok(Error::MigrationRequired)),
            "{act:?}"
        );
    }
    assert_eq!(
        s.client.try_lock_upgrades(),
        Err(Ok(Error::MigrationRequired))
    );
    assert_eq!(s.snapshot(), before);

    // Reads still work.
    assert_eq!(s.status(funded), Status::Funded);
    assert_eq!(s.client.storage_version(), 2);
    assert_eq!(s.client.escrow_count(), 3);
    // Keepers and the upgrade path stay open, so a fix can be shipped.
    s.client.extend_escrow_ttl(&funded);
    s.client.set_paused(&true);
    assert!(s.client.upgrades_enabled());
}

/// The fixture's v2 `migrate` runs once, permissionlessly, then the data is
/// on layout 2.
#[test]
fn fixture_migrate_runs_once() {
    let s = Setup::new();
    let id = s.funded();
    let hash = s.env.deployer().upload_contract_wasm(v2::WASM);
    s.client.upgrade(&hash);
    let upgraded = v2::Client::new(&s.env, &s.contract);
    assert!(!upgraded.migrated());

    s.env.mock_auths(&[]);
    upgraded.migrate();
    assert!(s.env.auths().is_empty(), "migrate needs no signature");
    s.env.mock_all_auths();
    assert_eq!(upgraded.storage_version(), 2);
    assert!(upgraded.migrated());
    assert!(upgraded.try_migrate().is_err(), "a second call errors");
    assert_eq!(upgraded.get_escrow(&id).amount, AMOUNT);
    assert_eq!(s.balance(&s.contract), AMOUNT);
}

/// The committed fixture says it is version 2 / storage 2, which is what
/// scripts/upgrade.sh reads before installing it.
#[test]
fn fixture_meta_says_version_two() {
    assert_eq!(wasm_meta(v2::WASM, "sisonke_version").as_deref(), Some("2"));
    assert_eq!(
        wasm_meta(v2::WASM, "sisonke_storage_version").as_deref(),
        Some("2")
    );
    assert_eq!(wasm_meta(v2::WASM, "no_such_key"), None);
}
