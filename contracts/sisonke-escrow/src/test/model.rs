//! Random operation sequences, checked step by step against a plain Rust
//! model of what the escrow should hold. Catches interactions the example
//! tests don't think of (dispute → time warp → concession → resolve…).
//!
//! Every step is signed by one random actor through `mock_auths`, so the
//! model also predicts every auth failure. After each step the invariants
//! I1, I2, I3, I4, I5, I6, I11, I12 and I13 are checked against the contract.

extern crate std;

use std::{
    collections::{BTreeSet, HashMap},
    format,
    string::String,
    vec::Vec,
};

use soroban_sdk::{testutils::Ledger as _, Address, IntoVal, InvokeError};

use super::{Act, Setup, Terms, DAY};
use crate::{Error, PartyRole, Status, PAGE_SIZE};

/// Override for a longer soak: `MODEL_SEEDS=300 cargo test model`.
const SEEDS: u64 = 12;
const STEPS: usize = 250;
/// Actors 0..3 can be parties; 3 is the admin, 4 a stranger who never is.
const USERS: usize = 3;
const ADMIN: usize = 3;
const ACTORS: usize = 5;
const USER_FUNDS: i128 = 1_000_000_000_000_000;

/// xorshift64*: deterministic, so a failing seed reproduces exactly.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

/// What a call should do.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Outcome {
    Ok,
    Err(Error),
    /// Refused by the host at `require_auth`.
    Auth,
}

#[derive(Clone, Debug)]
struct Model {
    payer: usize,
    recipient: usize,
    arbiter: Option<usize>,
    amount: i128,
    deadline: u64,
    status: Status,
    paid_to_recipient: i128,
    paid_to_payer: i128,
    funded_events: u32,
    closing_events: u32,
}

fn is_final(s: Status) -> bool {
    matches!(
        s,
        Status::Released | Status::Refunded | Status::Split | Status::Cancelled
    )
}

/// I6: the edges of docs/PLAN.md §4, plus staying put.
fn edge_allowed(from: Status, to: Status) -> bool {
    use Status::*;
    from == to
        || matches!(
            (from, to),
            (Created, Funded)
                | (Created, Cancelled)
                | (Funded, Released)
                | (Funded, Refunded)
                | (Funded, Disputed)
                | (Disputed, Released)
                | (Disputed, Refunded)
                | (Disputed, Split)
        )
}

struct World<'a> {
    s: Setup<'a>,
    actors: Vec<Address>,
    escrows: Vec<Model>,
    /// Status of each escrow as last read from the contract.
    seen: Vec<Status>,
    balances: Vec<i128>,
    contract_balance: i128,
    donations: i128,
    paused: bool,
    /// Whether an upgrade proposal is pending (it never runs here).
    upgrade_pending: bool,
    now: u64,
    index: HashMap<(usize, u8), Vec<u64>>,
    hits: BTreeSet<String>,
}

fn role_code(role: PartyRole) -> u8 {
    match role {
        PartyRole::Payer => 0,
        PartyRole::Recipient => 1,
        PartyRole::Arbiter => 2,
    }
}

impl World<'_> {
    fn new() -> Self {
        let s = Setup::new();
        let actors = std::vec![
            s.payer.clone(),
            s.recipient.clone(),
            s.arbiter.clone(),
            s.admin.clone(),
            s.stranger.clone(),
        ];
        let mut balances = Vec::new();
        for (i, who) in actors.iter().enumerate() {
            if i < USERS {
                let have = s.balance(who);
                s.usdc_admin.mint(who, &(USER_FUNDS - have));
            }
            balances.push(s.balance(who));
        }
        World {
            s,
            actors,
            escrows: Vec::new(),
            seen: Vec::new(),
            balances,
            contract_balance: 0,
            donations: 0,
            paused: false,
            upgrade_pending: false,
            now: super::START,
            index: HashMap::new(),
            hits: BTreeSet::new(),
        }
    }

    fn actor_of(&self, a: &Address) -> usize {
        self.actors.iter().position(|x| x == a).unwrap()
    }

    /// 65% the expected signer, otherwise anyone.
    fn signer(&self, rng: &mut Rng, expected: Option<usize>) -> usize {
        match expected {
            Some(who) if rng.chance(65) => who,
            _ => rng.below(ACTORS),
        }
    }

    /// Mostly an open escrow, sometimes any escrow, sometimes an unknown id.
    fn pick_id(&self, rng: &mut Rng) -> u64 {
        let n = self.escrows.len() as u64;
        if n == 0 || rng.chance(6) {
            return [0, n + 1, n + 50][rng.below(3)];
        }
        let open: Vec<u64> = (1..=n)
            .filter(|&id| !is_final(self.escrows[id as usize - 1].status))
            .collect();
        if !open.is_empty() && rng.chance(75) {
            open[rng.below(open.len())]
        } else {
            1 + rng.below(n as usize) as u64
        }
    }

    fn get(&self, id: u64) -> Option<&Model> {
        id.checked_sub(1).and_then(|i| self.escrows.get(i as usize))
    }

    fn step(&mut self, rng: &mut Rng, log: &mut Vec<String>) {
        match rng.below(23) {
            0..=1 => self.create(rng, log, false),
            2..=4 => self.create(rng, log, true),
            5..=6 => self.act(rng, log, ActKind::Fund),
            7..=8 => self.act(rng, log, ActKind::Release),
            9..=10 => self.act(rng, log, ActKind::Refund),
            11..=12 => self.act(rng, log, ActKind::Reclaim),
            13..=14 => self.act(rng, log, ActKind::Dispute),
            15..=16 => self.act(rng, log, ActKind::Resolve),
            17 => self.act(rng, log, ActKind::Cancel),
            18..=19 => self.warp(rng, log),
            20 => self.toggle_pause(rng, log),
            21 => self.toggle_upgrade(rng, log),
            _ => self.donate(rng, log),
        }
    }

    fn create(&mut self, rng: &mut Rng, log: &mut Vec<String>, fund: bool) {
        let payer = rng.below(USERS);
        let recipient = if rng.chance(8) {
            payer
        } else {
            (payer + 1 + rng.below(USERS - 1)) % USERS
        };
        let third = (0..USERS).find(|&u| u != payer && u != recipient);
        let arbiter = match rng.below(10) {
            0 => Some(payer),
            1..=6 => third.or(Some(ADMIN + 1)),
            _ => None,
        };
        let amount = if rng.chance(8) {
            -(rng.below(3) as i128)
        } else {
            1 + rng.below(5_000_000) as i128
        };
        let deadline = if rng.chance(5) {
            self.now
        } else {
            self.now + 1 + rng.below(3 * DAY as usize) as u64
        };
        let signer = self.signer(rng, Some(payer));

        let expected = if signer != payer {
            Outcome::Auth
        } else if self.paused {
            Outcome::Err(Error::Paused)
        } else if amount <= 0 {
            Outcome::Err(Error::InvalidAmount)
        } else if payer == recipient {
            Outcome::Err(Error::SameParty)
        } else if arbiter == Some(payer) || arbiter == Some(recipient) {
            Outcome::Err(Error::InvalidArbiter)
        } else if deadline <= self.now {
            Outcome::Err(Error::DeadlineInPast)
        } else {
            Outcome::Ok
        };
        let name = if fund { "create_and_fund" } else { "create" };
        log.push(format!(
            "{name}(p{payer} r{recipient} a{arbiter:?} {amount} dl+{}) by {signer} -> {expected:?}",
            deadline.saturating_sub(self.now)
        ));
        self.hits.insert(format!("{name} {expected:?}"));

        let t = Terms {
            payer: self.actors[payer].clone(),
            recipient: self.actors[recipient].clone(),
            arbiter: arbiter.map(|a| self.actors[a].clone()),
            amount,
            deadline,
            title: self.s.str("model"),
            terms_hash: None,
        };
        let who = self.actors[signer].clone();
        let got = self.s.as_signer(&who, name, t.args(&self.s.env), || {
            if fund {
                self.s.try_create_and_fund(&t)
            } else {
                self.s.try_create(&t)
            }
        });
        let events = self.s.event_names();
        let got_id = match &got {
            Ok(Ok(id)) => Some(*id),
            _ => None,
        };
        assert_eq!(outcome(got), expected);
        if expected != Outcome::Ok {
            assert!(events.is_empty(), "failed call emitted {events:?}");
            return;
        }

        let id = self.escrows.len() as u64 + 1;
        assert_eq!(got_id, Some(id), "ids are sequential");
        let mut m = Model {
            payer,
            recipient,
            arbiter,
            amount,
            deadline,
            status: Status::Created,
            paid_to_recipient: 0,
            paid_to_payer: 0,
            funded_events: 0,
            closing_events: 0,
        };
        let mut want = std::vec![("created".into(), Some(id))];
        if fund {
            m.status = Status::Funded;
            self.balances[payer] -= amount;
            self.contract_balance += amount;
            want.push(("funded".into(), Some(id)));
        }
        self.escrows.push(m);
        self.seen.push(Status::Created);
        self.index_push(payer, PartyRole::Payer, id);
        if fund {
            self.index_counterparties(id);
        }
        self.record_events(&events, &want);
    }

    fn act(&mut self, rng: &mut Rng, log: &mut Vec<String>, kind: ActKind) {
        // Disputes are rare, so `resolve` usually targets one, or it would
        // almost never get past the status check.
        let disputed: Vec<u64> = (1..=self.escrows.len() as u64)
            .filter(|&id| self.escrows[id as usize - 1].status == Status::Disputed)
            .collect();
        let id = if matches!(kind, ActKind::Resolve) && !disputed.is_empty() && rng.chance(60) {
            disputed[rng.below(disputed.len())]
        } else {
            self.pick_id(rng)
        };
        let m = self.get(id).cloned();
        let now = self.now;

        // Pick the arguments and the signer, then predict.
        let (act, signer, expected) = match kind {
            ActKind::Dispute => {
                let by = match &m {
                    Some(m) if rng.chance(80) => {
                        if rng.chance(50) {
                            m.payer
                        } else {
                            m.recipient
                        }
                    }
                    _ => rng.below(ACTORS),
                };
                let signer = self.signer(rng, Some(by));
                let expected = match &m {
                    None => Outcome::Err(Error::NotFound),
                    Some(_) if signer != by => Outcome::Auth,
                    Some(m) if by != m.payer && by != m.recipient => Outcome::Err(Error::NotParty),
                    Some(m) if m.status != Status::Funded => Outcome::Err(Error::InvalidStatus),
                    Some(m) if m.arbiter.is_none() => Outcome::Err(Error::NoArbiter),
                    Some(m) if now >= m.deadline => Outcome::Err(Error::DeadlinePassed),
                    Some(_) => Outcome::Ok,
                };
                (Act::Dispute(self.actors[by].clone()), signer, expected)
            }
            ActKind::Resolve => {
                let amount = m.as_ref().map(|m| m.amount).unwrap_or(1_000);
                let split = match rng.below(10) {
                    0 => -1,
                    1 => amount + 1,
                    2 => 0,
                    3 => amount,
                    _ => rng.below(amount as usize + 1) as i128,
                };
                let signer = self.signer(rng, m.as_ref().and_then(|m| m.arbiter));
                let expected = match &m {
                    None => Outcome::Err(Error::NotFound),
                    Some(m) if m.arbiter.is_none() => Outcome::Err(Error::NoArbiter),
                    Some(m) if Some(signer) != m.arbiter => Outcome::Auth,
                    Some(m) if m.status != Status::Disputed => Outcome::Err(Error::InvalidStatus),
                    Some(m) if split < 0 || split > m.amount => Outcome::Err(Error::InvalidSplit),
                    Some(_) => Outcome::Ok,
                };
                (Act::Resolve(split), signer, expected)
            }
            _ => {
                let required = |m: &Model| match kind {
                    ActKind::Refund => m.recipient,
                    _ => m.payer,
                };
                let signer = self.signer(rng, m.as_ref().map(required));
                let expected = match &m {
                    None => Outcome::Err(Error::NotFound),
                    Some(m) if signer != required(m) => Outcome::Auth,
                    Some(m) => self.predict(kind, m),
                };
                let act = match kind {
                    ActKind::Fund => Act::Fund,
                    ActKind::Release => Act::Release,
                    ActKind::Refund => Act::Refund,
                    ActKind::Reclaim => Act::Reclaim,
                    _ => Act::Cancel,
                };
                (act, signer, expected)
            }
        };
        log.push(format!(
            "{}(#{id} {act:?}) by {signer} -> {expected:?}",
            act.name()
        ));
        self.hits.insert(format!("{} {expected:?}", act.name()));

        let who = self.actors[signer].clone();
        let got = self.s.act_as(&who, &act, id);
        let events = self.s.event_names();
        assert_eq!(outcome(got), expected);
        if expected != Outcome::Ok {
            assert!(events.is_empty(), "failed call emitted {events:?}");
            return;
        }

        // Apply to the model.
        let i = id as usize - 1;
        let m = &mut self.escrows[i];
        let (status, to_recipient, to_payer, event) = match &act {
            Act::Fund => (Status::Funded, 0, 0, "funded"),
            Act::Cancel => (Status::Cancelled, 0, 0, "cancelled"),
            Act::Release => (Status::Released, m.amount, 0, "released"),
            Act::Refund => (Status::Refunded, 0, m.amount, "refunded"),
            Act::Reclaim => (Status::Refunded, 0, m.amount, "reclaimed"),
            Act::Dispute(_) => (Status::Disputed, 0, 0, "disputed"),
            Act::Resolve(split) => {
                let status = if *split == m.amount {
                    Status::Released
                } else if *split == 0 {
                    Status::Refunded
                } else {
                    Status::Split
                };
                (status, *split, m.amount - split, "resolved")
            }
        };
        let funded_now = matches!(act, Act::Fund);
        if funded_now {
            self.balances[m.payer] -= m.amount;
            self.contract_balance += m.amount;
        }
        m.status = status;
        if is_final(status) {
            m.paid_to_recipient = to_recipient;
            m.paid_to_payer = to_payer;
            self.balances[m.recipient] += to_recipient;
            self.balances[m.payer] += to_payer;
            self.contract_balance -= to_recipient + to_payer;
        }
        if funded_now {
            self.index_counterparties(id);
        }
        self.record_events(&events, &[(event.into(), Some(id))]);
    }

    /// Status and time rules for the id-only writes, once auth has passed.
    fn predict(&self, kind: ActKind, m: &Model) -> Outcome {
        let locked = matches!(m.status, Status::Funded | Status::Disputed);
        match kind {
            ActKind::Fund if self.paused => Outcome::Err(Error::Paused),
            ActKind::Fund if m.status != Status::Created => Outcome::Err(Error::InvalidStatus),
            ActKind::Fund if self.now >= m.deadline => Outcome::Err(Error::DeadlinePassed),
            ActKind::Release | ActKind::Refund if !locked => Outcome::Err(Error::InvalidStatus),
            ActKind::Reclaim if m.status != Status::Funded => Outcome::Err(Error::InvalidStatus),
            ActKind::Reclaim if self.now < m.deadline => Outcome::Err(Error::DeadlineNotReached),
            ActKind::Cancel if m.status != Status::Created => Outcome::Err(Error::InvalidStatus),
            _ => Outcome::Ok,
        }
    }

    /// I5: checks the call emitted exactly `want`, and counts funding and
    /// closing events per escrow.
    fn record_events(&mut self, got: &[(String, Option<u64>)], want: &[(String, Option<u64>)]) {
        assert_eq!(got, want);
        for (name, id) in got {
            let m = &mut self.escrows[id.unwrap() as usize - 1];
            match name.as_str() {
                "funded" => m.funded_events += 1,
                "released" | "refunded" | "reclaimed" | "resolved" | "cancelled" => {
                    m.closing_events += 1
                }
                _ => {}
            }
            assert!(m.funded_events <= 1 && m.closing_events <= 1, "I5");
        }
    }

    fn warp(&mut self, rng: &mut Rng, log: &mut Vec<String>) {
        // Often land exactly on, or just before, some escrow's deadline.
        let target = match self.escrows.get(rng.below(self.escrows.len().max(1))) {
            Some(m) if rng.chance(40) && m.deadline > self.now => m.deadline - rng.below(2) as u64,
            _ => self.now + rng.below(DAY as usize) as u64,
        };
        self.now = target.max(self.now);
        log.push(format!("warp to {}", self.now));
        let now = self.now;
        self.s.env.ledger().with_mut(|l| {
            l.timestamp = now;
            l.sequence_number += 1;
        });
    }

    /// The recipient and the arbiter see an escrow once it is funded.
    fn index_counterparties(&mut self, id: u64) {
        let m = self.escrows[id as usize - 1].clone();
        self.index_push(m.recipient, PartyRole::Recipient, id);
        if let Some(arbiter) = m.arbiter {
            self.index_push(arbiter, PartyRole::Arbiter, id);
        }
    }

    fn index_push(&mut self, who: usize, role: PartyRole, id: u64) {
        self.index
            .entry((who, role_code(role)))
            .or_default()
            .push(id);
    }

    /// Proposes or cancels an upgrade. The model's predictions for every
    /// escrow call ignore it, which is the point: a pending upgrade never
    /// changes what users can do.
    fn toggle_upgrade(&mut self, rng: &mut Rng, log: &mut Vec<String>) {
        let signer = self.signer(rng, Some(ADMIN));
        let name = if self.upgrade_pending {
            "cancel_upgrade"
        } else {
            "propose_upgrade"
        };
        let expected = if signer == ADMIN {
            Outcome::Ok
        } else {
            Outcome::Auth
        };
        log.push(format!("{name} by {signer} -> {expected:?}"));
        self.hits.insert(format!("{name} {expected:?}"));
        let who = self.actors[signer].clone();
        let hash = soroban_sdk::BytesN::from_array(&self.s.env, &[7; 32]);
        let got = if self.upgrade_pending {
            self.s
                .as_signer(&who, name, soroban_sdk::Vec::new(&self.s.env), || {
                    self.s.client.try_cancel_upgrade()
                })
        } else {
            self.s
                .as_signer(&who, name, (hash.clone(),).into_val(&self.s.env), || {
                    self.s.client.try_propose_upgrade(&hash)
                })
        };
        assert_eq!(outcome(got), expected);
        if expected == Outcome::Ok {
            self.upgrade_pending = !self.upgrade_pending;
        }
    }

    fn toggle_pause(&mut self, rng: &mut Rng, log: &mut Vec<String>) {
        let paused = !self.paused;
        let signer = self.signer(rng, Some(ADMIN));
        let expected = if signer == ADMIN {
            Outcome::Ok
        } else {
            Outcome::Auth
        };
        log.push(format!("set_paused({paused}) by {signer} -> {expected:?}"));
        self.hits.insert(format!("set_paused {expected:?}"));
        let who = self.actors[signer].clone();
        let got = self
            .s
            .as_signer(&who, "set_paused", (paused,).into_val(&self.s.env), || {
                self.s.client.try_set_paused(&paused)
            });
        assert_eq!(outcome(got), expected);
        if expected == Outcome::Ok {
            self.paused = paused;
        }
    }

    fn donate(&mut self, rng: &mut Rng, log: &mut Vec<String>) {
        let amount = 1 + rng.below(1_000) as i128;
        log.push(format!("donate {amount}"));
        self.s.usdc_admin.mint(&self.s.contract, &amount);
        self.contract_balance += amount;
        self.donations += amount;
    }

    fn check(&mut self) {
        let c = &self.s.client;
        let n = self.escrows.len() as u64;

        // I12: ids are 1..=count.
        assert_eq!(c.escrow_count(), n);

        let mut locked = 0;
        for start in (1..=n).step_by(crate::MAX_BATCH as usize) {
            let end = (start + crate::MAX_BATCH as u64 - 1).min(n);
            let mut ids = soroban_sdk::Vec::new(&self.s.env);
            for id in start..=end {
                ids.push_back(id);
            }
            for view in c.get_escrows(&ids).iter() {
                let e = view.escrow;
                let i = e.id as usize - 1;
                let m = &self.escrows[i];
                // I9 and the model's view of the record.
                assert_eq!(self.actor_of(&e.payer), m.payer);
                assert_eq!(self.actor_of(&e.recipient), m.recipient);
                assert_eq!(e.arbiter.as_ref().map(|a| self.actor_of(a)), m.arbiter);
                assert_eq!((e.amount, e.deadline), (m.amount, m.deadline));
                assert_eq!(e.status, m.status, "escrow #{}", e.id);
                // I6: only the documented edges.
                assert!(
                    edge_allowed(self.seen[i], e.status),
                    "#{}: {:?} -> {:?}",
                    e.id,
                    self.seen[i],
                    e.status
                );
                self.seen[i] = e.status;
                // I2: exact payout.
                assert_eq!(
                    (e.paid_to_recipient, e.paid_to_payer),
                    (m.paid_to_recipient, m.paid_to_payer)
                );
                match e.status {
                    Status::Released => {
                        assert_eq!((e.paid_to_recipient, e.paid_to_payer), (e.amount, 0))
                    }
                    Status::Refunded => {
                        assert_eq!((e.paid_to_recipient, e.paid_to_payer), (0, e.amount))
                    }
                    Status::Split => {
                        assert!(e.paid_to_recipient > 0 && e.paid_to_payer > 0);
                        assert_eq!(e.paid_to_recipient + e.paid_to_payer, e.amount);
                    }
                    _ => assert_eq!((e.paid_to_recipient, e.paid_to_payer), (0, 0)),
                }
                // I11: disputes need an arbiter and happen before the deadline.
                if e.status == Status::Disputed || e.disputed_by.is_some() {
                    assert!(e.arbiter.is_some());
                    assert!(e.disputed_at < e.deadline);
                }
                // I4: a final escrow records when and by whom it closed.
                if is_final(e.status) {
                    assert!(e.closed_by.is_some());
                }
                if matches!(e.status, Status::Funded | Status::Disputed) {
                    locked += e.amount;
                }
            }
        }

        // I1: conservation.
        assert_eq!(c.total_locked(), locked);
        let contract_balance = self.s.balance(&self.s.contract);
        assert_eq!(contract_balance, self.contract_balance);
        assert_eq!(contract_balance, locked + self.donations);

        // I3: everyone holds exactly what the model paid them.
        for (i, who) in self.actors.iter().enumerate() {
            assert_eq!(self.s.balance(who), self.balances[i], "actor {i}");
        }
        assert_eq!(c.is_paused(), self.paused);
        assert_eq!(c.pending_upgrade().is_some(), self.upgrade_pending);

        // I13: each id once per party and role, in order, pages bounded.
        for who in 0..ACTORS {
            for role in [PartyRole::Payer, PartyRole::Recipient, PartyRole::Arbiter] {
                let want = self
                    .index
                    .get(&(who, role_code(role)))
                    .cloned()
                    .unwrap_or_default();
                let addr = &self.actors[who];
                assert_eq!(c.party_escrow_count(addr, &role) as usize, want.len());
                let pages = (want.len() as u32).div_ceil(PAGE_SIZE);
                let mut got = Vec::new();
                for page in 0..=pages {
                    let ids = c.party_escrow_ids(addr, &role, &page);
                    assert!(ids.len() <= PAGE_SIZE);
                    got.extend(ids.iter());
                }
                assert_eq!(got, want, "index of actor {who} as {role:?}");
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum ActKind {
    Fund,
    Release,
    Refund,
    Reclaim,
    Dispute,
    Resolve,
    Cancel,
}

fn outcome<T, E: core::fmt::Debug>(r: Result<Result<T, E>, Result<Error, InvokeError>>) -> Outcome {
    match r {
        Ok(Ok(_)) => Outcome::Ok,
        Err(Ok(e)) => Outcome::Err(e),
        Err(Err(InvokeError::Abort)) => Outcome::Auth,
        Ok(Err(e)) => panic!("conversion error {e:?}"),
        Err(Err(e)) => panic!("unexpected host error {e:?}"),
    }
}

const MUST_HIT: [&str; 33] = [
    "create Ok",
    "create Auth",
    "create Err(Paused)",
    "create Err(InvalidAmount)",
    "create Err(SameParty)",
    "create Err(InvalidArbiter)",
    "create Err(DeadlineInPast)",
    "create_and_fund Ok",
    "create_and_fund Auth",
    "fund Ok",
    "fund Auth",
    "fund Err(Paused)",
    "fund Err(InvalidStatus)",
    "fund Err(DeadlinePassed)",
    "fund Err(NotFound)",
    "release Ok",
    "release Auth",
    "release Err(InvalidStatus)",
    "refund Ok",
    "refund Auth",
    "reclaim Ok",
    "reclaim Err(DeadlineNotReached)",
    "reclaim Err(InvalidStatus)",
    "dispute Ok",
    "dispute Err(NotParty)",
    "dispute Err(NoArbiter)",
    "dispute Err(DeadlinePassed)",
    "resolve Ok",
    "resolve Err(InvalidSplit)",
    "resolve Err(NoArbiter)",
    "cancel Ok",
    "propose_upgrade Ok",
    "cancel_upgrade Ok",
];

#[test]
fn model_random_sequences_hold_invariants() {
    let mut hits = BTreeSet::new();
    let seeds = std::env::var("MODEL_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(SEEDS);
    for seed in 1..=seeds {
        let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        let mut world = World::new();
        let mut log = Vec::new();
        for _ in 0..STEPS {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                world.step(&mut rng, &mut log);
                world.check();
            }));
            if let Err(e) = result {
                std::eprintln!("seed {seed} failed after:");
                for line in log.iter().rev().take(15).rev() {
                    std::eprintln!("  {line}");
                }
                std::panic::resume_unwind(e);
            }
        }
        hits.extend(world.hits);
    }
    for outcome in MUST_HIT {
        assert!(hits.contains(outcome), "never reached: {outcome}");
    }
    for name in [
        "resolve Auth",
        "dispute Auth",
        "set_paused Auth",
        "reclaim Auth",
    ] {
        assert!(hits.contains(name), "never reached: {name}");
    }
}
