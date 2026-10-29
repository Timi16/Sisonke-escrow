//! Every successful write emits exactly the events below; failed calls emit none.
//!
//! Escrow events have topics `("sisonke", <action>, id)`, and the action is
//! the name of the function that ran, so the UI can fetch one escrow's whole
//! history with a single RPC `getEvents` filter: `("sisonke", *, id)`.
//! `created` carries every term, so an indexer can rebuild each escrow from
//! events alone. Data is a map keyed by field name unless noted.

use soroban_sdk::{contractevent, Address, BytesN, Env, String};

use crate::types::{Escrow, PendingUpgrade, Status};

/// Topics: `("sisonke", "init")`. Emitted once, by the constructor.
#[contractevent(topics = ["sisonke", "init"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Init {
    pub admin: Address,
    pub token: Address,
    pub version: u32,
    pub upgrade_delay: u64,
}

#[contractevent(topics = ["sisonke", "created"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created {
    #[topic]
    pub id: u64,
    pub payer: Address,
    pub recipient: Address,
    pub arbiter: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub deadline: u64,
    pub title: String,
    pub terms_hash: Option<BytesN<32>>,
}

#[contractevent(topics = ["sisonke", "funded"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Funded {
    #[topic]
    pub id: u64,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent(topics = ["sisonke", "released"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Released {
    #[topic]
    pub id: u64,
    /// The payer.
    pub by: Address,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent(topics = ["sisonke", "refunded"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub id: u64,
    /// The recipient.
    pub by: Address,
    pub payer: Address,
    pub amount: i128,
}

/// The payer took the funds back at or after the deadline.
#[contractevent(topics = ["sisonke", "reclaimed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reclaimed {
    #[topic]
    pub id: u64,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent(topics = ["sisonke", "disputed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Disputed {
    #[topic]
    pub id: u64,
    /// The payer or the recipient.
    pub by: Address,
}

#[contractevent(topics = ["sisonke", "resolved"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resolved {
    #[topic]
    pub id: u64,
    pub arbiter: Address,
    pub recipient_amount: i128,
    pub payer_amount: i128,
    /// `Released`, `Refunded` or `Split`.
    pub status: Status,
}

#[contractevent(topics = ["sisonke", "cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cancelled {
    #[topic]
    pub id: u64,
    pub payer: Address,
}

/// Topics: `("sisonke", "paused")`.
#[contractevent(topics = ["sisonke", "paused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paused {
    pub paused: bool,
}

/// Topics: `("sisonke", "admin_proposed", new_admin)`. Data: `[]`.
#[contractevent(topics = ["sisonke", "admin_proposed"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposed {
    #[topic]
    pub new_admin: Address,
}

/// Topics: `("sisonke", "admin_proposal_cancelled")`. Data: `[]`.
#[contractevent(topics = ["sisonke", "admin_proposal_cancelled"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposalCancelled {}

/// Topics: `("sisonke", "admin_changed", new_admin)`.
#[contractevent(topics = ["sisonke", "admin_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    #[topic]
    pub new_admin: Address,
    pub previous_admin: Address,
}

/// An upgrade was proposed; it can run from `eta`. Topics:
/// `("sisonke", "upgrade_proposed")`. The web app should show this as a
/// banner: until `eta`, either party of an escrow can still move its funds
/// out of the new code's reach (docs/CONTRACT.md, trust assumption #1).
#[contractevent(topics = ["sisonke", "upgrade_proposed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposed {
    pub new_wasm_hash: BytesN<32>,
    pub proposed_at: u64,
    pub eta: u64,
    pub expires_at: u64,
}

/// A pending upgrade was withdrawn: `cancel_upgrade`, `lock_upgrades`, an
/// admin handover, or a new proposal replacing it (emitted just before the
/// new `upgrade_proposed`). Topics: `("sisonke", "upgrade_cancelled")`.
#[contractevent(topics = ["sisonke", "upgrade_cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeCancelled {
    pub wasm_hash: BytesN<32>,
}

/// Topics: `("sisonke", "upgrade_delay_changed")`.
#[contractevent(topics = ["sisonke", "upgrade_delay_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeDelayChanged {
    pub previous: u64,
    pub delay: u64,
    /// The pending proposal's `eta` after the change (pushed out if the new
    /// delay requires it), or `None` if nothing is pending.
    pub pending_eta: Option<u64>,
}

/// The code is being replaced. Topics: `("sisonke", "upgraded")`.
#[contractevent(topics = ["sisonke", "upgraded"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Upgraded {
    pub new_wasm_hash: BytesN<32>,
    /// Version of the code that performed the upgrade.
    pub from_version: u32,
}

/// Upgrades are now permanently disabled. Topics: `("sisonke", "upgrades_locked")`.
/// Data: `[]`.
#[contractevent(topics = ["sisonke", "upgrades_locked"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradesLocked {}

/// Storage moved to a new layout. Topics: `("sisonke", "migrated")`.
/// Defined in v1 so the shape is fixed, first emitted by a v2 `migrate`.
#[contractevent(topics = ["sisonke", "migrated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Migrated {
    pub from: u32,
    pub to: u32,
}

pub fn init(env: &Env, admin: &Address, token: &Address, version: u32, upgrade_delay: u64) {
    Init {
        admin: admin.clone(),
        token: token.clone(),
        version,
        upgrade_delay,
    }
    .publish(env);
}

pub fn upgrade_proposed(env: &Env, pending: &PendingUpgrade) {
    UpgradeProposed {
        new_wasm_hash: pending.wasm_hash.clone(),
        proposed_at: pending.proposed_at,
        eta: pending.eta,
        expires_at: pending.expires_at,
    }
    .publish(env);
}

pub fn upgrade_cancelled(env: &Env, wasm_hash: &BytesN<32>) {
    UpgradeCancelled {
        wasm_hash: wasm_hash.clone(),
    }
    .publish(env);
}

pub fn upgrade_delay_changed(env: &Env, previous: u64, delay: u64, pending_eta: Option<u64>) {
    UpgradeDelayChanged {
        previous,
        delay,
        pending_eta,
    }
    .publish(env);
}

pub fn created(env: &Env, escrow: &Escrow) {
    Created {
        id: escrow.id,
        payer: escrow.payer.clone(),
        recipient: escrow.recipient.clone(),
        arbiter: escrow.arbiter.clone(),
        token: escrow.token.clone(),
        amount: escrow.amount,
        deadline: escrow.deadline,
        title: escrow.title.clone(),
        terms_hash: escrow.terms_hash.clone(),
    }
    .publish(env);
}

pub fn funded(env: &Env, escrow: &Escrow) {
    Funded {
        id: escrow.id,
        payer: escrow.payer.clone(),
        amount: escrow.amount,
    }
    .publish(env);
}

pub fn released(env: &Env, escrow: &Escrow) {
    Released {
        id: escrow.id,
        by: escrow.payer.clone(),
        recipient: escrow.recipient.clone(),
        amount: escrow.amount,
    }
    .publish(env);
}

pub fn refunded(env: &Env, escrow: &Escrow) {
    Refunded {
        id: escrow.id,
        by: escrow.recipient.clone(),
        payer: escrow.payer.clone(),
        amount: escrow.amount,
    }
    .publish(env);
}

pub fn reclaimed(env: &Env, escrow: &Escrow) {
    Reclaimed {
        id: escrow.id,
        payer: escrow.payer.clone(),
        amount: escrow.amount,
    }
    .publish(env);
}

pub fn disputed(env: &Env, id: u64, by: &Address) {
    Disputed { id, by: by.clone() }.publish(env);
}

pub fn resolved(
    env: &Env,
    id: u64,
    arbiter: &Address,
    recipient_amount: i128,
    payer_amount: i128,
    status: Status,
) {
    Resolved {
        id,
        arbiter: arbiter.clone(),
        recipient_amount,
        payer_amount,
        status,
    }
    .publish(env);
}

pub fn cancelled(env: &Env, escrow: &Escrow) {
    Cancelled {
        id: escrow.id,
        payer: escrow.payer.clone(),
    }
    .publish(env);
}

pub fn paused(env: &Env, paused: bool) {
    Paused { paused }.publish(env);
}

pub fn admin_proposed(env: &Env, new_admin: &Address) {
    AdminProposed {
        new_admin: new_admin.clone(),
    }
    .publish(env);
}

pub fn admin_proposal_cancelled(env: &Env) {
    AdminProposalCancelled {}.publish(env);
}

pub fn admin_changed(env: &Env, new_admin: &Address, previous_admin: &Address) {
    AdminChanged {
        new_admin: new_admin.clone(),
        previous_admin: previous_admin.clone(),
    }
    .publish(env);
}

pub fn upgraded(env: &Env, new_wasm_hash: &BytesN<32>, from_version: u32) {
    Upgraded {
        new_wasm_hash: new_wasm_hash.clone(),
        from_version,
    }
    .publish(env);
}

pub fn upgrades_locked(env: &Env) {
    UpgradesLocked {}.publish(env);
}

/// v1 never migrates; kept so every version shares one `migrated` shape.
#[allow(dead_code)]
pub fn migrated(env: &Env, from: u32, to: u32) {
    Migrated { from, to }.publish(env);
}
