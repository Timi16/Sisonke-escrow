//! Runs against the compiled contract, which is what Testnet executes.
//!
//! Ignored by plain `cargo test` because it needs a fresh build; `make test`
//! builds first and includes them.

extern crate std;

use super::{new_env, v2, wasm_meta, Act, Setup, AMOUNT, DEADLINE, PAYER_START};
use crate::{Error, Status};

const WASM: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/wasm32v1-none/release/sisonke_escrow.wasm"
);

const MAX_WASM_BYTES: usize = 64 * 1024;
/// The network's per-transaction limit is 100M instructions; stay far below.
const MAX_INSTRUCTIONS: i64 = 10_000_000;

fn wasm() -> std::vec::Vec<u8> {
    let wasm = std::fs::read(WASM)
        .unwrap_or_else(|_| panic!("{WASM} missing: run `make build` (or `make test`)"));

    // Refuse to test a build older than the source it came from.
    let built = std::fs::metadata(WASM).unwrap().modified().unwrap();
    let src = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    for entry in std::fs::read_dir(src).unwrap().flatten() {
        let changed = entry.metadata().unwrap().modified().unwrap();
        if entry.path().extension().is_some_and(|e| e == "rs") && changed > built {
            panic!("{WASM} is older than {:?}: rebuild first", entry.path());
        }
    }
    wasm
}

fn setup_wasm<'a>(bytes: &[u8]) -> Setup<'a> {
    Setup::new_in(new_env(), Some(bytes), None)
}

#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn compiled_v1_full_lifecycle() {
    let bytes = wasm();
    let s = setup_wasm(&bytes);
    assert_eq!(s.client.version(), 1);
    assert_eq!(s.client.token(), s.usdc.address);

    // create → fund → release
    let a = s.create();
    s.client.fund(&a);
    s.client.release(&a);
    assert_eq!(s.status(a), Status::Released);
    assert_eq!(s.client.try_release(&a), Err(Ok(Error::InvalidStatus)));

    // create_and_fund → refund
    let b = s.funded();
    s.client.refund(&b);
    assert_eq!(s.status(b), Status::Refunded);

    // dispute → split, with the wrong signers refused at auth
    let c = s.funded();
    s.client.dispute(&c, &s.recipient);
    super::assert_auth_abort(s.act_as(&s.stranger, &Act::Resolve(1), c));
    super::assert_auth_abort(s.act_as(&s.recipient, &Act::Release, c));
    assert_eq!(s.client.try_reclaim(&c), Err(Ok(Error::InvalidStatus)));
    s.client.resolve(&c, &(AMOUNT / 2));
    assert_eq!(s.status(c), Status::Split);

    // cancel, and reclaim at the deadline
    let d = s.create();
    s.client.cancel(&d);
    let e = s.funded();
    assert_eq!(s.client.try_reclaim(&e), Err(Ok(Error::DeadlineNotReached)));
    s.set_time(DEADLINE);
    s.client.reclaim(&e);
    assert_eq!(s.status(e), Status::Refunded);

    assert_eq!(s.client.total_locked(), 0);
    assert_eq!(s.balance(&s.contract), 0);
    assert_eq!(s.balance(&s.recipient), AMOUNT + AMOUNT / 2);
    assert_eq!(s.balance(&s.payer), PAYER_START - AMOUNT - AMOUNT / 2);
    assert_eq!(s.client.escrow_count(), 5);
}

#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn compiled_v1_upgrade_to_fixture_and_rollback_before_migrate() {
    let v1 = wasm();
    let s = setup_wasm(&v1);
    let id = s.funded();
    let disputed = s.disputed();
    let v1_hash = s.env.deployer().upload_contract_wasm(v1.as_slice());
    let v2_hash = s.env.deployer().upload_contract_wasm(v2::WASM);

    s.upgrade_to(&v2_hash);
    let upgraded = v2::Client::new(&s.env, &s.contract);
    assert_eq!(upgraded.version(), 2);
    assert_eq!(upgraded.get_escrow(&id).status, v2::Status::Funded);
    assert_eq!(upgraded.get_escrow(&disputed).status, v2::Status::Disputed);
    assert_eq!(upgraded.total_locked(), 2 * AMOUNT);

    // Roll back before migrating, through the fixture's own timelock: v1
    // picks up exactly where it was.
    s.upgrade_to(&v1_hash);
    assert_eq!(s.client.version(), 1);
    assert_eq!(s.client.storage_version(), 1);
    s.client.release(&id);
    s.client.resolve(&disputed, &0);
    assert_eq!(s.balance(&s.recipient), AMOUNT);
    assert_eq!(s.client.total_locked(), 0);
    assert_eq!(s.balance(&s.contract), 0);
}

/// After a v2 migration, rolled-back v1 code sees a newer layout and refuses
/// every write (141). Reads still work, and upgrading forward again works.
#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn rollback_after_migration_blocks_v1_writes() {
    let v1 = wasm();
    let s = setup_wasm(&v1);
    let id = s.funded();
    let v1_hash = s.env.deployer().upload_contract_wasm(v1.as_slice());
    let v2_hash = s.env.deployer().upload_contract_wasm(v2::WASM);

    s.upgrade_to(&v2_hash);
    let upgraded = v2::Client::new(&s.env, &s.contract);
    upgraded.migrate();
    assert_eq!(upgraded.storage_version(), 2);
    s.upgrade_to(&v1_hash);

    assert_eq!(s.client.version(), 1);
    assert_eq!(s.client.storage_version(), 2);
    assert_eq!(s.client.try_release(&id), Err(Ok(Error::MigrationRequired)));
    assert_eq!(
        s.try_create_and_fund(&s.terms()),
        Err(Ok(Error::MigrationRequired))
    );
    assert_eq!(
        s.client.try_lock_upgrades(),
        Err(Ok(Error::MigrationRequired))
    );
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::MigrationRequired)));
    assert_eq!(s.status(id), Status::Funded);
    assert_eq!(s.balance(&s.contract), AMOUNT);

    // The way forward stays open: v1 can still propose and run an upgrade.
    s.upgrade_to(&v2_hash);
    assert_eq!(upgraded.version(), 2);
    assert_eq!(upgraded.get_escrow(&id).amount, AMOUNT);
}

/// The compiled v1's timelock against the real fixture wasm: too early at
/// `eta - 1`, every exit works while the upgrade is pending, and the upgrade
/// runs at `eta`.
#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn compiled_v1_timelocked_upgrade_to_fixture() {
    let bytes = wasm();
    let s = setup_wasm(&bytes);
    let to_release = s.funded();
    let kept = s.funded();
    let v2_hash = s.env.deployer().upload_contract_wasm(v2::WASM);

    s.client.propose_upgrade(&v2_hash);
    let pending = s.client.pending_upgrade().unwrap();
    assert_eq!(pending.eta, pending.proposed_at + super::UPGRADE_DELAY);
    s.set_time(pending.eta - 1);
    assert_eq!(
        s.client.try_upgrade(&s.pending_hash()),
        Err(Ok(Error::UpgradeTooEarly))
    );
    // A user who distrusts the proposal leaves before it can run.
    s.client.release(&to_release);
    assert_eq!(s.status(to_release), Status::Released);

    s.set_time(pending.eta);
    s.client.upgrade(&s.pending_hash());
    let upgraded = v2::Client::new(&s.env, &s.contract);
    assert_eq!(upgraded.version(), 2);
    assert_eq!(upgraded.pending_upgrade(), None);
    assert_eq!(upgraded.get_escrow(&kept).status, v2::Status::Funded);
    assert_eq!(upgraded.total_locked(), AMOUNT);
}

#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn wasm_size_under_64_kib() {
    let size = wasm().len();
    std::println!("sisonke_escrow.wasm: {size} bytes");
    assert!(size <= MAX_WASM_BYTES, "wasm is {size} bytes");
}

/// scripts/upgrade.sh reads these from the wasm before installing it.
#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn wasm_meta_matches_version_constants() {
    let bytes = wasm();
    assert_eq!(
        wasm_meta(&bytes, "sisonke_version"),
        Some(std::format!("{}", crate::VERSION))
    );
    assert_eq!(
        wasm_meta(&bytes, "sisonke_storage_version"),
        Some(std::format!("{}", crate::STORAGE_VERSION))
    );
}

#[test]
#[ignore = "needs a fresh wasm build: run `make test`"]
fn release_and_create_and_fund_within_budget() {
    let bytes = wasm();
    let s = setup_wasm(&bytes);

    let id = s.funded();
    let create_and_fund = s.env.cost_estimate().resources();
    s.client.release(&id);
    let release = s.env.cost_estimate().resources();
    let id = s.disputed();
    s.client.resolve(&id, &1);
    let resolve = s.env.cost_estimate().resources();

    std::println!("create_and_fund: {create_and_fund:#?}");
    std::println!("release:         {release:#?}");
    std::println!("resolve (split): {resolve:#?}");
    for (name, r) in [
        ("create_and_fund", &create_and_fund),
        ("release", &release),
        ("resolve", &resolve),
    ] {
        assert!(
            r.instructions < MAX_INSTRUCTIONS,
            "{name}: {} instructions",
            r.instructions
        );
    }
}
