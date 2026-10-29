//! Shared fixtures for the test suites (docs/PLAN.md §9).
//!
//! - `lifecycle`: happy paths and time boundaries
//! - `duplicates`: duplicate execution and finality of closed escrows
//! - `auth`: who may sign what, with `mock_auths` only
//! - `dispute`: arbiter flows and concessions
//! - `validation`: create input checks, unknown ids, batch limits
//! - `accounting`: `TotalLocked`, isolation, donations, atomicity
//! - `adversary`: attacker-minded tests; `// VULN:` marks a live vulnerability
//! - `index`: the paged party index and batch reads
//! - `events`: exact event shapes
//! - `admin`: pause and the two-step admin handover
//! - `upgrade`: upgrades of the native contract to the fixture wasm
//! - `timelock`: propose → delay → upgrade, and exits during the delay
//! - `ttl`: entries stay alive across months of ledgers
//! - `model`: random operation sequences checked against a reference model
//! - `wasm`: the compiled contract, its size, costs, upgrades and rollbacks
//!
//! `mock_all_auths` is only used to set up state. Every test about who may
//! sign goes through `Setup::as_signer`, which installs `mock_auths` for
//! exactly one signer and one call tree.

extern crate std;

mod accounting;
mod admin;
mod adversary;
mod auth;
mod dispute;
mod duplicates;
mod events;
mod index;
mod lifecycle;
mod model;
mod timelock;
mod ttl;
mod upgrade;
mod validation;
mod wasm;

use core::fmt::Debug;

use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    xdr, Address, BytesN, Env, IntoVal, InvokeError, String, TryFromVal, Val, Vec,
};

use crate::{Error, Escrow, SisonkeEscrow, SisonkeEscrowClient, Status};

/// The compiled test-only "v2" (contracts/upgrade-fixture), committed under
/// testdata/ so the tests don't depend on build order.
pub mod v2 {
    soroban_sdk::contractimport!(file = "testdata/upgrade_fixture.wasm");
}

pub const START: u64 = 1_750_000_000;
pub const SEQUENCE: u32 = 1_000;
pub const DAY: u64 = 86_400;
pub const DEADLINE: u64 = START + 7 * DAY;
/// 50 USDC (7 decimals).
pub const AMOUNT: i128 = 500_000_000;
pub const PAYER_START: i128 = 10 * AMOUNT;
/// The upgrade delay every test instance is deployed with: one hour.
pub const UPGRADE_DELAY: u64 = 3_600;
/// Testnet's current `max_entry_ttl`; extending past it would fail.
pub const NETWORK_MAX_TTL: u32 = 3_110_400;

/// What every `try_` client call returns.
pub type TryResult<T> =
    Result<Result<T, <T as TryFromVal<Env, Val>>::Error>, Result<Error, InvokeError>>;

/// A test env that doesn't write test_snapshots/ files.
pub fn new_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

/// The value of a `contractmeta!` entry in a wasm file. Entries are XDR
/// `SCMetaV0 { key: string, val: string }` (u32 length, bytes, zero padding
/// to 4), so the encoded key is followed directly by the encoded value.
pub fn wasm_meta(wasm: &[u8], key: &str) -> Option<std::string::String> {
    let mut encoded = (key.len() as u32).to_be_bytes().to_vec();
    encoded.extend_from_slice(key.as_bytes());
    encoded.resize(encoded.len().div_ceil(4) * 4, 0);
    let at = wasm.windows(encoded.len()).position(|w| w == encoded)? + encoded.len();
    let len = u32::from_be_bytes(wasm.get(at..at + 4)?.try_into().ok()?) as usize;
    let val = wasm.get(at + 4..at + 4 + len)?;
    Some(std::str::from_utf8(val).ok()?.into())
}

/// Asserts the call was aborted by the host (`Err(Err(InvokeError::Abort))`)
/// rather than returning a contract error. That is how a failed
/// `require_auth` surfaces; in these tests nothing else in the calls under
/// test aborts, so it identifies an auth refusal.
pub fn assert_auth_abort<T: Debug, E: Debug>(
    result: Result<Result<T, E>, Result<Error, InvokeError>>,
) {
    assert!(
        matches!(result, Err(Err(InvokeError::Abort))),
        "expected an auth abort, got {result:?}"
    );
}

/// The escrow terms `create` and `create_and_fund` take, in argument order.
#[derive(Clone, Debug)]
pub struct Terms {
    pub payer: Address,
    pub recipient: Address,
    pub arbiter: Option<Address>,
    pub amount: i128,
    pub deadline: u64,
    pub title: String,
    pub terms_hash: Option<BytesN<32>>,
}

impl Terms {
    pub fn args(&self, env: &Env) -> Vec<Val> {
        (
            self.payer.clone(),
            self.recipient.clone(),
            self.arbiter.clone(),
            self.amount,
            self.deadline,
            self.title.clone(),
            self.terms_hash.clone(),
        )
            .into_val(env)
    }
}

/// The escrow writes that take an id, for table-driven tests.
#[derive(Clone, Debug)]
pub enum Act {
    Fund,
    Cancel,
    Release,
    Refund,
    Reclaim,
    Dispute(Address),
    Resolve(i128),
}

impl Act {
    pub fn name(&self) -> &'static str {
        match self {
            Act::Fund => "fund",
            Act::Cancel => "cancel",
            Act::Release => "release",
            Act::Refund => "refund",
            Act::Reclaim => "reclaim",
            Act::Dispute(_) => "dispute",
            Act::Resolve(_) => "resolve",
        }
    }
}

/// Everything a call could change: balances, every escrow, the counters and
/// the settings. Used to prove a refused call changed nothing.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Snapshot {
    pub balances: std::vec::Vec<i128>,
    pub escrows: std::vec::Vec<Escrow>,
    pub total_locked: i128,
    pub info: crate::ContractInfo,
}

pub struct Setup<'a> {
    pub env: Env,
    pub contract: Address,
    pub client: SisonkeEscrowClient<'a>,
    pub admin: Address,
    pub payer: Address,
    pub recipient: Address,
    pub arbiter: Address,
    pub stranger: Address,
    /// The pinned token, a real Stellar Asset Contract unless a test swaps it.
    pub usdc: TokenClient<'a>,
    pub usdc_admin: StellarAssetClient<'a>,
}

impl<'a> Setup<'a> {
    /// Fake USDC as a real Stellar Asset Contract, minted to the payer, and
    /// the escrow registered natively with `(admin, usdc)`.
    pub fn new() -> Self {
        Self::new_in(new_env(), None, None)
    }

    /// Like `new()`, on a given `Env`, optionally running compiled `wasm`
    /// instead of the native contract, and optionally pinning `token` (which
    /// must have a SAC-style `mint`) instead of a fresh SAC.
    pub fn new_in(env: Env, wasm: Option<&[u8]>, token: Option<Address>) -> Self {
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = START;
            l.sequence_number = SEQUENCE;
        });
        env.ledger().set_max_entry_ttl(NETWORK_MAX_TTL);

        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let stranger = Address::generate(&env);

        let token = token.unwrap_or_else(|| {
            env.register_stellar_asset_contract_v2(Address::generate(&env))
                .address()
        });
        let usdc = TokenClient::new(&env, &token);
        let usdc_admin = StellarAssetClient::new(&env, &token);
        usdc_admin.mint(&payer, &PAYER_START);

        // Last call of the setup, so `events()` still shows `init`.
        let contract = match wasm {
            Some(wasm) => env.register(wasm, (&admin, &token, UPGRADE_DELAY)),
            None => env.register(SisonkeEscrow, (&admin, &token, UPGRADE_DELAY)),
        };
        let client = SisonkeEscrowClient::new(&env, &contract);

        Setup {
            env,
            contract,
            client,
            admin,
            payer,
            recipient,
            arbiter,
            stranger,
            usdc,
            usdc_admin,
        }
    }

    pub fn str(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }

    pub fn hash(&self, byte: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[byte; 32])
    }

    /// Default terms: payer → recipient, with an arbiter, 50 USDC, 7 days.
    pub fn terms(&self) -> Terms {
        Terms {
            payer: self.payer.clone(),
            recipient: self.recipient.clone(),
            arbiter: Some(self.arbiter.clone()),
            amount: AMOUNT,
            deadline: DEADLINE,
            title: self.str("Logo design"),
            terms_hash: Some(self.hash(7)),
        }
    }

    pub fn terms_no_arbiter(&self) -> Terms {
        Terms {
            arbiter: None,
            ..self.terms()
        }
    }

    pub fn try_create(&self, t: &Terms) -> TryResult<u64> {
        self.client.try_create(
            &t.payer,
            &t.recipient,
            &t.arbiter,
            &t.amount,
            &t.deadline,
            &t.title,
            &t.terms_hash,
        )
    }

    pub fn try_create_and_fund(&self, t: &Terms) -> TryResult<u64> {
        self.client.try_create_and_fund(
            &t.payer,
            &t.recipient,
            &t.arbiter,
            &t.amount,
            &t.deadline,
            &t.title,
            &t.terms_hash,
        )
    }

    pub fn create_with(&self, t: &Terms) -> u64 {
        self.try_create(t).unwrap().unwrap()
    }

    pub fn create_and_fund_with(&self, t: &Terms) -> u64 {
        self.try_create_and_fund(t).unwrap().unwrap()
    }

    /// A `Created` escrow with the default terms.
    pub fn create(&self) -> u64 {
        self.create_with(&self.terms())
    }

    /// A `Funded` escrow with the default terms.
    pub fn funded(&self) -> u64 {
        self.create_and_fund_with(&self.terms())
    }

    /// A `Disputed` escrow, disputed by the recipient.
    pub fn disputed(&self) -> u64 {
        let id = self.funded();
        self.client.dispute(&id, &self.recipient);
        id
    }

    pub fn escrow(&self, id: u64) -> Escrow {
        self.client.get_escrow(&id).escrow
    }

    pub fn status(&self, id: u64) -> Status {
        self.escrow(id).status
    }

    pub fn set_time(&self, timestamp: u64) {
        self.env.ledger().with_mut(|l| l.timestamp = timestamp);
    }

    /// Moves the ledger forward by whole days: sequence and timestamp.
    pub fn advance_days(&self, days: u32) {
        self.env.ledger().with_mut(|l| {
            l.sequence_number += days * crate::DAY_IN_LEDGERS;
            l.timestamp += days as u64 * DAY;
        });
    }

    pub fn balance(&self, who: &Address) -> i128 {
        self.usdc.balance(who)
    }

    /// This contract's events from the last invocation.
    pub fn events(&self) -> soroban_sdk::testutils::ContractEvents {
        self.env.events().all().filter_by_contract(&self.contract)
    }

    /// `(action, id)` of each of this contract's events from the last
    /// invocation, read from the raw topics.
    pub fn event_names(&self) -> std::vec::Vec<(std::string::String, Option<u64>)> {
        self.events()
            .events()
            .iter()
            .map(|e| {
                let xdr::ContractEventBody::V0(body) = &e.body;
                let topics = body.topics.as_slice();
                let name = match &topics[1] {
                    xdr::ScVal::Symbol(s) => s.to_utf8_string_lossy(),
                    other => panic!("action topic is not a symbol: {other:?}"),
                };
                let id = match topics.get(2) {
                    Some(xdr::ScVal::U64(id)) => Some(*id),
                    _ => None,
                };
                (name, id)
            })
            .collect()
    }

    /// Balances of payer, recipient, arbiter, admin, stranger and contract.
    pub fn balances(&self) -> std::vec::Vec<i128> {
        [
            &self.payer,
            &self.recipient,
            &self.arbiter,
            &self.admin,
            &self.stranger,
            &self.contract,
        ]
        .iter()
        .map(|a| self.balance(a))
        .collect()
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            balances: self.balances(),
            escrows: (1..=self.client.escrow_count())
                .map(|id| self.escrow(id))
                .collect(),
            total_locked: self.client.total_locked(),
            info: self.client.info(),
        }
    }

    /// The transfer a call signed by `who` makes on its behalf, if any:
    /// `fund` and `create_and_fund` move `amount` from the payer.
    fn transfer_for(&self, fn_name: &str, args: &Vec<Val>) -> Option<i128> {
        match fn_name {
            "fund" => {
                let id = u64::try_from_val(&self.env, &args.get(0)?).ok()?;
                let view = self.client.try_get_escrow(&id).ok()?.ok()?;
                Some(view.escrow.amount)
            }
            "create_and_fund" => i128::try_from_val(&self.env, &args.get(3)?).ok(),
            _ => None,
        }
    }

    /// Runs `call` with only `who` signing, and only for the top-level call
    /// `fn_name(args)` (plus the payer → contract transfer for `fund` and
    /// `create_and_fund`). Restores `mock_all_auths` afterwards.
    pub fn as_signer<R>(
        &self,
        who: &Address,
        fn_name: &str,
        args: Vec<Val>,
        call: impl FnOnce() -> R,
    ) -> R {
        let subs: std::vec::Vec<MockAuthInvoke> = match self.transfer_for(fn_name, &args) {
            Some(amount) => std::vec![MockAuthInvoke {
                contract: &self.usdc.address,
                fn_name: "transfer",
                args: (who.clone(), self.contract.clone(), amount).into_val(&self.env),
                sub_invokes: &[],
            }],
            None => std::vec![],
        };
        self.env.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.contract,
                fn_name,
                args,
                sub_invokes: &subs,
            },
        }]);
        let result = call();
        self.env.mock_all_auths();
        result
    }

    /// The pending upgrade's hash, which `upgrade(expected_wasm_hash)` must
    /// be given, or all zeros if nothing is pending.
    pub fn pending_hash(&self) -> BytesN<32> {
        v2::Client::new(&self.env, &self.contract)
            .pending_upgrade()
            .map(|p| p.wasm_hash)
            .unwrap_or_else(|| BytesN::from_array(&self.env, &[0; 32]))
    }

    /// `upgrade(pending_hash)`'s arguments, for `as_signer`.
    pub fn upgrade_args(&self) -> Vec<Val> {
        (self.pending_hash(),).into_val(&self.env)
    }

    /// The whole timelocked upgrade with every signature mocked: propose
    /// `hash`, move the clock to its `eta`, run `upgrade`. Works on v1 and on
    /// the fixture, which share the same upgrade functions.
    pub fn upgrade_to(&self, hash: &BytesN<32>) {
        self.env.mock_all_auths();
        let fixture = v2::Client::new(&self.env, &self.contract);
        fixture.propose_upgrade(hash);
        let eta = fixture.pending_upgrade().unwrap().eta;
        self.set_time(eta.max(self.env.ledger().timestamp()));
        fixture.upgrade(hash);
    }

    pub fn act_args(&self, act: &Act, id: u64) -> Vec<Val> {
        match act {
            Act::Dispute(by) => (id, by.clone()).into_val(&self.env),
            Act::Resolve(amount) => (id, *amount).into_val(&self.env),
            _ => (id,).into_val(&self.env),
        }
    }

    /// Runs `act` on escrow `id` with whatever auth is installed.
    pub fn try_act(&self, act: &Act, id: u64) -> TryResult<()> {
        match act {
            Act::Fund => self.client.try_fund(&id),
            Act::Cancel => self.client.try_cancel(&id),
            Act::Release => self.client.try_release(&id),
            Act::Refund => self.client.try_refund(&id),
            Act::Reclaim => self.client.try_reclaim(&id),
            Act::Dispute(by) => self.client.try_dispute(&id, by),
            Act::Resolve(amount) => self.client.try_resolve(&id, amount),
        }
    }

    /// Runs `act` on escrow `id` signed only by `who`.
    pub fn act_as(&self, who: &Address, act: &Act, id: u64) -> TryResult<()> {
        self.as_signer(who, act.name(), self.act_args(act, id), || {
            self.try_act(act, id)
        })
    }
}
