import {Address} from '@stellar/stellar-sdk';

    /**
 * Struct: Escrow
 */
export interface Escrow {
  /**
   * Smallest unit of the token (USDC = 7 decimals). Always > 0.
   */
  amount: bigint;
  /**
   * `None` means there is no dispute path.
   */
  arbiter: string | null;
  /**
   * 0 until the escrow reaches a final status.
   */
  closed_at: bigint;
  /**
   * Signer of the call that closed the escrow.
   */
  closed_by: string | null;
  created_at: bigint;
  /**
   * Ledger the escrow was created in; where the UI starts `getEvents`.
   */
  created_ledger: number;
  /**
   * Ledger timestamp, seconds. At `now == deadline` the deadline has passed.
   */
  deadline: bigint;
  /**
   * 0 unless disputed.
   */
  disputed_at: bigint;
  /**
   * The payer or the recipient, if disputed.
   */
  disputed_by: string | null;
  /**
   * 0 until funded.
   */
  funded_at: bigint;
  /**
   * 1 or more, never reused.
   */
  id: bigint;
  /**
   * 0 until final.
   */
  paid_to_payer: bigint;
  /**
   * 0 until final.
   */
  paid_to_recipient: bigint;
  payer: string;
  recipient: string;
  status: Status;
  /**
   * sha256 of the off-chain agreement, if any.
   */
  terms_hash: Uint8Array | null;
  /**
   * At most 64 bytes, may be empty.
   */
  title: string;
  /**
   * The token pinned at construction (Testnet USDC SAC).
   */
  token: string;
  /**
   * Ledger of the last transition, as a hint for event lookups.
   */
  updated_ledger: number;
}

/**
 * Lifecycle of an escrow. Status only ever moves forward:
 *
 * ```text
 * Created ──fund──▶ Funded ──release──────────▶ Released
 * │                 ├──refund / reclaim────▶ Refunded
 * │                 └──dispute──▶ Disputed ─┬─release / resolve(all)──▶ Released
 * │                                         ├─refund / resolve(none)──▶ Refunded
 * │                                         └─resolve(split)──────────▶ Split
 * └──cancel──▶ Cancelled
 * ```
 *
 * Final statuses say where the money went, not who closed the escrow; that
 * is in `Escrow::closed_by` and in the event name.
 */
 export type Status =
  /**
   * Agreement made, nothing locked yet.
   */
  { tag: "Created"; values: void } |
  /**
   * The amount is locked in the contract.
   */
  { tag: "Funded"; values: void } |
  /**
   * Locked, and the arbiter may now divide it. Payer and recipient can
   * still concede (release / refund).
   */
  { tag: "Disputed"; values: void } |
  /**
   * All of the amount went to the recipient. Final.
   */
  { tag: "Released"; values: void } |
  /**
   * All of the amount went back to the payer. Final.
   */
  { tag: "Refunded"; values: void } |
  /**
   * The arbiter divided the amount; both sides got something. Final.
   */
  { tag: "Split"; values: void } |
  /**
   * Closed before it was funded. Nothing moved. Final.
   */
  { tag: "Cancelled"; values: void };

/**
 * Which side of an escrow an address is on, for the party index.
 */
 export type PartyRole =
  { tag: "Payer"; values: void } |
  { tag: "Recipient"; values: void } |
  { tag: "Arbiter"; values: void };

/**
 * What read calls return: the stored escrow plus whether its deadline has
 * passed (`now >= deadline`), so the UI needs no clock of its own.
 */
export interface EscrowView {
  deadline_passed: boolean;
  escrow: Escrow;
}

/**
 * Everything the web app header needs, in one read.
 */
export interface ContractInfo {
  admin: string;
  escrow_count: bigint;
  paused: boolean;
  pending_admin: string | null;
  pending_upgrade_eta: bigint | null;
  pending_upgrade_expires_at: bigint | null;
  /**
   * The proposed upgrade's wasm hash and `eta`, flattened from
   * `pending_upgrade()` (an `Option` of a struct can't be a field here).
   * Show them prominently: before `eta` either party can still move each
   * escrow's funds out of the new code's reach (to the counterparty, or
   * back to the payer after the deadline).
   */
  pending_upgrade_hash: Uint8Array | null;
  storage_version: number;
  token: string;
  total_locked: bigint;
  upgrade_delay: bigint;
  upgrades_locked: boolean;
  version: number;
}

/**
 * An upgrade the admin has proposed. `upgrade` can install `wasm_hash`
 * from `eta` (`proposed_at + upgrade_delay`) until `expires_at`
 * (`eta + UPGRADE_WINDOW`); after that it must be proposed again.
 */
export interface PendingUpgrade {
  eta: bigint;
  expires_at: bigint;
  proposed_at: bigint;
  wasm_hash: Uint8Array;
}

/**
 * Contract error codes. Stable: never renumber or reuse a code.
 *
 * Codes start at 100 so they never collide with the Stellar Asset Contract's
 * own codes (1–13), which reach the caller unchanged when a transfer fails.
 *
 * Unauthorized callers never reach these: `require_auth()` fails first and
 * the transaction aborts with a host auth error.
 */
export const Error = {
  /**
   * No escrow with this id.
   */
  100 : { message: "NotFound" },
  /**
   * The escrow's status does not allow this action. Every duplicate
   * (second fund, second release, acting on a closed escrow) lands here.
   */
  101 : { message: "InvalidStatus" },
  /**
   * `fund` or `dispute` at or after the deadline.
   */
  102 : { message: "DeadlinePassed" },
  /**
   * `reclaim` before the deadline.
   */
  103 : { message: "DeadlineNotReached" },
  /**
   * `dispute` or `resolve` on an escrow created without an arbiter.
   */
  104 : { message: "NoArbiter" },
  /**
   * `dispute` by an address that is neither the payer nor the recipient.
   */
  105 : { message: "NotParty" },
  /**
   * `resolve` with `recipient_amount < 0` or `> amount`.
   */
  106 : { message: "InvalidSplit" },
  /**
   * The contract's balance did not grow by exactly `amount` when funding.
   */
  107 : { message: "TransferMismatch" },
  /**
   * Amount must be greater than zero.
   */
  120 : { message: "InvalidAmount" },
  /**
   * Payer and recipient must be different addresses.
   */
  121 : { message: "SameParty" },
  /**
   * The arbiter must be neither the payer nor the recipient.
   */
  122 : { message: "InvalidArbiter" },
  /**
   * The payer, recipient or arbiter is this contract.
   */
  123 : { message: "InvalidParty" },
  /**
   * Deadline must be in the future when creating.
   */
  124 : { message: "DeadlineInPast" },
  /**
   * Deadline is more than 365 days away.
   */
  125 : { message: "DeadlineTooFar" },
  /**
   * Title is longer than 64 bytes.
   */
  126 : { message: "TitleTooLong" },
  /**
   * `get_escrows` was asked for more than 20 ids.
   */
  127 : { message: "BatchTooLarge" },
  /**
   * Title is not valid UTF-8, or contains an ASCII control byte
   * (below 0x20, or 0x7F).
   */
  128 : { message: "InvalidTitle" },
  /**
   * New escrows and funding are paused.
   */
  140 : { message: "Paused" },
  /**
   * The stored data is not in the layout this code expects; run `migrate`.
   */
  141 : { message: "MigrationRequired" },
  /**
   * `migrate` was called but the data is already current.
   */
  142 : { message: "NothingToMigrate" },
  /**
   * Checked arithmetic overflowed (id counter, total locked, index count).
   */
  143 : { message: "Overflow" },
  /**
   * `lock_upgrades` has run, so the code can no longer change.
   */
  200 : { message: "UpgradesLocked" },
  /**
   * `accept_admin` or `cancel_admin_proposal` with no admin proposed.
   */
  201 : { message: "NoPendingAdmin" },
  /**
   * Upgrade delay outside `MIN_UPGRADE_DELAY..=MAX_UPGRADE_DELAY`
   * (constructor or `set_upgrade_delay`).
   */
  202 : { message: "InvalidUpgradeDelay" },
  /**
   * `upgrade` or `cancel_upgrade` with no upgrade proposed.
   */
  203 : { message: "NoPendingUpgrade" },
  /**
   * `upgrade` before the proposal's `eta`.
   */
  204 : { message: "UpgradeTooEarly" },
  /**
   * `set_upgrade_delay` below the current delay.
   */
  205 : { message: "UpgradeDelayDecrease" },
  /**
   * `upgrade(expected_wasm_hash)` with a hash other than the pending one.
   */
  206 : { message: "UpgradeHashMismatch" },
  /**
   * `upgrade` after the proposal's `expires_at`: propose it again.
   */
  207 : { message: "UpgradeExpired" }
}

/**
 * Topics: `("sisonke", "init")`. Emitted once, by the constructor.
 */
export interface InitEvent {
  name: "Init";
  data: {
    admin?: string;
    token?: string;
    version?: number;
    upgrade_delay?: bigint;
  };
}

/**
 * Event: Funded
 */
export interface FundedEvent {
  name: "Funded";
  data: {
    id: bigint;
    payer?: string;
    amount?: bigint;
  };
}

/**
 * Topics: `("sisonke", "paused")`.
 */
export interface PausedEvent {
  name: "Paused";
  data: {
    paused?: boolean;
  };
}

/**
 * Event: Created
 */
export interface CreatedEvent {
  name: "Created";
  data: {
    id: bigint;
    payer?: string;
    recipient?: string;
    arbiter?: string | null;
    token?: string;
    amount?: bigint;
    deadline?: bigint;
    title?: string;
    terms_hash?: Uint8Array | null;
  };
}

/**
 * Event: Disputed
 */
export interface DisputedEvent {
  name: "Disputed";
  data: {
    id: bigint;
    /**
     * The payer or the recipient.
     */
    by?: string;
  };
}

/**
 * Event: Refunded
 */
export interface RefundedEvent {
  name: "Refunded";
  data: {
    id: bigint;
    /**
     * The recipient.
     */
    by?: string;
    payer?: string;
    amount?: bigint;
  };
}

/**
 * Event: Released
 */
export interface ReleasedEvent {
  name: "Released";
  data: {
    id: bigint;
    /**
     * The payer.
     */
    by?: string;
    recipient?: string;
    amount?: bigint;
  };
}

/**
 * Event: Resolved
 */
export interface ResolvedEvent {
  name: "Resolved";
  data: {
    id: bigint;
    arbiter?: string;
    recipient_amount?: bigint;
    payer_amount?: bigint;
    /**
     * `Released`, `Refunded` or `Split`.
     */
    status?: Status;
  };
}

/**
 * The code is being replaced. Topics: `("sisonke", "upgraded")`.
 */
export interface UpgradedEvent {
  name: "Upgraded";
  data: {
    new_wasm_hash?: Uint8Array;
    /**
     * Version of the code that performed the upgrade.
     */
    from_version?: number;
  };
}

/**
 * Event: Cancelled
 */
export interface CancelledEvent {
  name: "Cancelled";
  data: {
    id: bigint;
    payer?: string;
  };
}

/**
 * The payer took the funds back at or after the deadline.
 */
export interface ReclaimedEvent {
  name: "Reclaimed";
  data: {
    id: bigint;
    payer?: string;
    amount?: bigint;
  };
}

/**
 * Topics: `("sisonke", "admin_changed", new_admin)`.
 */
export interface AdminChangedEvent {
  name: "AdminChanged";
  data: {
    new_admin: string;
    previous_admin?: string;
  };
}

/**
 * Topics: `("sisonke", "admin_proposed", new_admin)`. Data: `[]`.
 */
export interface AdminProposedEvent {
  name: "AdminProposed";
  data: {
    new_admin: string;
  };
}

/**
 * Upgrades are now permanently disabled. Topics: `("sisonke", "upgrades_locked")`.
 * Data: `[]`.
 */
export interface UpgradesLockedEvent {
  name: "UpgradesLocked";
  data: {

  };
}

/**
 * An upgrade was proposed; it can run from `eta`. Topics:
 * `("sisonke", "upgrade_proposed")`. The web app should show this as a
 * banner: until `eta`, either party of an escrow can still move its funds
 * out of the new code's reach (docs/CONTRACT.md, trust assumption #1).
 */
export interface UpgradeProposedEvent {
  name: "UpgradeProposed";
  data: {
    new_wasm_hash?: Uint8Array;
    proposed_at?: bigint;
    eta?: bigint;
    expires_at?: bigint;
  };
}

/**
 * A pending upgrade was withdrawn: `cancel_upgrade`, `lock_upgrades`, an
 * admin handover, or a new proposal replacing it (emitted just before the
 * new `upgrade_proposed`). Topics: `("sisonke", "upgrade_cancelled")`.
 */
export interface UpgradeCancelledEvent {
  name: "UpgradeCancelled";
  data: {
    wasm_hash?: Uint8Array;
  };
}

/**
 * Topics: `("sisonke", "upgrade_delay_changed")`.
 */
export interface UpgradeDelayChangedEvent {
  name: "UpgradeDelayChanged";
  data: {
    previous?: bigint;
    delay?: bigint;
    /**
     * The pending proposal's `eta` after the change (pushed out if the new
     * delay requires it), or `None` if nothing is pending.
     */
    pending_eta?: bigint | null;
  };
}

/**
 * Topics: `("sisonke", "admin_proposal_cancelled")`. Data: `[]`.
 */
export interface AdminProposalCancelledEvent {
  name: "AdminProposalCancelled";
  data: {

  };
}
    export type ContractEvent = InitEvent | FundedEvent | PausedEvent | CreatedEvent | DisputedEvent | RefundedEvent | ReleasedEvent | ResolvedEvent | UpgradedEvent | CancelledEvent | ReclaimedEvent | AdminChangedEvent | AdminProposedEvent | UpgradesLockedEvent | UpgradeProposedEvent | UpgradeCancelledEvent | UpgradeDelayChangedEvent | AdminProposalCancelledEvent;
    