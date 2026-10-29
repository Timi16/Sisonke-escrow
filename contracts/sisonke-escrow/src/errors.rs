use soroban_sdk::contracterror;

/// Contract error codes. Stable: never renumber or reuse a code.
///
/// Codes start at 100 so they never collide with the Stellar Asset Contract's
/// own codes (1–13), which reach the caller unchanged when a transfer fails.
///
/// Unauthorized callers never reach these: `require_auth()` fails first and
/// the transaction aborts with a host auth error.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No escrow with this id.
    NotFound = 100,
    /// The escrow's status does not allow this action. Every duplicate
    /// (second fund, second release, acting on a closed escrow) lands here.
    InvalidStatus = 101,
    /// `fund` or `dispute` at or after the deadline.
    DeadlinePassed = 102,
    /// `reclaim` before the deadline.
    DeadlineNotReached = 103,
    /// `dispute` or `resolve` on an escrow created without an arbiter.
    NoArbiter = 104,
    /// `dispute` by an address that is neither the payer nor the recipient.
    NotParty = 105,
    /// `resolve` with `recipient_amount < 0` or `> amount`.
    InvalidSplit = 106,
    /// The contract's balance did not grow by exactly `amount` when funding.
    TransferMismatch = 107,
    /// Amount must be greater than zero.
    InvalidAmount = 120,
    /// Payer and recipient must be different addresses.
    SameParty = 121,
    /// The arbiter must be neither the payer nor the recipient.
    InvalidArbiter = 122,
    /// The payer, recipient or arbiter is this contract.
    InvalidParty = 123,
    /// Deadline must be in the future when creating.
    DeadlineInPast = 124,
    /// Deadline is more than 365 days away.
    DeadlineTooFar = 125,
    /// Title is longer than 64 bytes.
    TitleTooLong = 126,
    /// `get_escrows` was asked for more than 20 ids.
    BatchTooLarge = 127,
    /// Title is not valid UTF-8, or contains an ASCII control byte
    /// (below 0x20, or 0x7F).
    InvalidTitle = 128,
    /// New escrows and funding are paused.
    Paused = 140,
    /// The stored data is not in the layout this code expects; run `migrate`.
    MigrationRequired = 141,
    /// `migrate` was called but the data is already current.
    NothingToMigrate = 142,
    /// Checked arithmetic overflowed (id counter, total locked, index count).
    Overflow = 143,
    /// `lock_upgrades` has run, so the code can no longer change.
    UpgradesLocked = 200,
    /// `accept_admin` or `cancel_admin_proposal` with no admin proposed.
    NoPendingAdmin = 201,
    /// Upgrade delay outside `MIN_UPGRADE_DELAY..=MAX_UPGRADE_DELAY`
    /// (constructor or `set_upgrade_delay`).
    InvalidUpgradeDelay = 202,
    /// `upgrade` or `cancel_upgrade` with no upgrade proposed.
    NoPendingUpgrade = 203,
    /// `upgrade` before the proposal's `eta`.
    UpgradeTooEarly = 204,
    /// `set_upgrade_delay` below the current delay.
    UpgradeDelayDecrease = 205,
    /// `upgrade(expected_wasm_hash)` with a hash other than the pending one.
    UpgradeHashMismatch = 206,
    /// `upgrade` after the proposal's `expires_at`: propose it again.
    UpgradeExpired = 207,
}
