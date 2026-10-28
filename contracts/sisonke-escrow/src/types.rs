//! Types stored on-chain or returned to callers.
//!
//! **Storage ABI.** These names and types *are* the stored encoding, so they
//! are frozen: never rename, remove, reorder-by-meaning or change the type of
//! - any `DataKey` variant or its field types (`Escrow(u64)`,
//!   `PartyCount(Address, PartyRole)`, `PartyPage(Address, PartyRole, u32)`),
//! - any `Status` variant (stored in every `Escrow`),
//! - any `PartyRole` variant (part of every index key: renaming one orphans
//!   every index),
//! - any `Escrow` field name or field type (a struct is stored as a map
//!   keyed by field name).
//!
//! `EscrowView` and `ContractInfo` are never stored, but their field names
//! are the client ABI, so the same rule applies to them.
//!
//! **Any addition is a layout change**: a new `DataKey` variant, `Status` or
//! `PartyRole` variant, or `Escrow` field (which must be `Option<T>`) means
//! bumping `STORAGE_VERSION` and shipping a `migrate`. Old code ignores
//! unknown map keys and would silently drop a new field when it rewrites a
//! record; the bump makes rolled-back old code refuse every write instead
//! (`MigrationRequired`). See docs/UPGRADES.md.

use soroban_sdk::{contracttype, Address, BytesN, String};

/// Lifecycle of an escrow. Status only ever moves forward:
///
/// ```text
/// Created ──fund──▶ Funded ──release──────────▶ Released
///    │                 ├──refund / reclaim────▶ Refunded
///    │                 └──dispute──▶ Disputed ─┬─release / resolve(all)──▶ Released
///    │                                         ├─refund / resolve(none)──▶ Refunded
///    │                                         └─resolve(split)──────────▶ Split
///    └──cancel──▶ Cancelled
/// ```
///
/// Final statuses say where the money went, not who closed the escrow; that
/// is in `Escrow::closed_by` and in the event name.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    /// Agreement made, nothing locked yet.
    Created,
    /// The amount is locked in the contract.
    Funded,
    /// Locked, and the arbiter may now divide it. Payer and recipient can
    /// still concede (release / refund).
    Disputed,
    /// All of the amount went to the recipient. Final.
    Released,
    /// All of the amount went back to the payer. Final.
    Refunded,
    /// The arbiter divided the amount; both sides got something. Final.
    Split,
    /// Closed before it was funded. Nothing moved. Final.
    Cancelled,
}

/// Which side of an escrow an address is on, for the party index.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PartyRole {
    Payer,
    Recipient,
    Arbiter,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    /// 1 or more, never reused.
    pub id: u64,
    pub payer: Address,
    pub recipient: Address,
    /// `None` means there is no dispute path.
    pub arbiter: Option<Address>,
    /// The token pinned at construction (Testnet USDC SAC).
    pub token: Address,
    /// Smallest unit of the token (USDC = 7 decimals). Always > 0.
    pub amount: i128,
    /// Ledger timestamp, seconds. At `now == deadline` the deadline has passed.
    pub deadline: u64,
    /// At most 64 bytes, may be empty.
    pub title: String,
    /// sha256 of the off-chain agreement, if any.
    pub terms_hash: Option<BytesN<32>>,
    pub status: Status,
    pub created_at: u64,
    /// Ledger the escrow was created in; where the UI starts `getEvents`.
    pub created_ledger: u32,
    /// 0 until funded.
    pub funded_at: u64,
    /// 0 unless disputed.
    pub disputed_at: u64,
    /// The payer or the recipient, if disputed.
    pub disputed_by: Option<Address>,
    /// 0 until the escrow reaches a final status.
    pub closed_at: u64,
    /// Signer of the call that closed the escrow.
    pub closed_by: Option<Address>,
    /// 0 until final.
    pub paid_to_recipient: i128,
    /// 0 until final.
    pub paid_to_payer: i128,
    /// Ledger of the last transition, as a hint for event lookups.
    pub updated_ledger: u32,
}

/// What read calls return: the stored escrow plus whether its deadline has
/// passed (`now >= deadline`), so the UI needs no clock of its own.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowView {
    pub escrow: Escrow,
    pub deadline_passed: bool,
}

/// Everything the web app header needs, in one read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractInfo {
    pub version: u32,
    pub storage_version: u32,
    pub admin: Address,
    pub pending_admin: Option<Address>,
    pub token: Address,
    pub paused: bool,
    pub upgrades_locked: bool,
    pub escrow_count: u64,
    pub total_locked: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Instance. `Address` that can pause inflows and authorize upgrades.
    Admin,
    /// Instance. `Address` named by `propose_admin`, until it accepts.
    PendingAdmin,
    /// Instance. The token every escrow uses. Set once, in the constructor.
    Token,
    /// Instance. `u64`, next escrow id to hand out. Starts at 1.
    NextId,
    /// Instance. `i128`, sum of the amounts of Funded and Disputed escrows.
    TotalLocked,
    /// Instance. `bool`, blocks `create`, `create_and_fund` and `fund`.
    Paused,
    /// Instance. `bool`, `true` once `lock_upgrades` has run. Never cleared.
    UpgradesLocked,
    /// Instance. `u32`, the storage layout version the data is in.
    StorageVersion,
    /// Persistent. The `Escrow` record.
    Escrow(u64),
    /// Persistent. `u32`, how many escrows the address has in this role.
    PartyCount(Address, PartyRole),
    /// Persistent. `Vec<u64>` of at most `PAGE_SIZE` ids, oldest first.
    PartyPage(Address, PartyRole, u32),
}
