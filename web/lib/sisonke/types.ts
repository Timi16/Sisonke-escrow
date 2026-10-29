/** Normalised shapes of what the contract returns (types.rs). */

export const STATUSES = ["Created", "Funded", "Disputed", "Released", "Refunded", "Split", "Cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const FINAL_STATUSES: readonly Status[] = ["Released", "Refunded", "Split", "Cancelled"];
export const isFinal = (s: Status) => FINAL_STATUSES.includes(s);
export const isLocked = (s: Status) => s === "Funded" || s === "Disputed";

export type PartyRole = "Payer" | "Recipient" | "Arbiter";

export interface Escrow {
  id: bigint;
  payer: string;
  recipient: string;
  arbiter: string | null;
  token: string;
  amount: bigint;
  deadline: number;
  title: string;
  /** Hex, or null. */
  termsHash: string | null;
  status: Status;
  createdAt: number;
  createdLedger: number;
  fundedAt: number;
  disputedAt: number;
  disputedBy: string | null;
  closedAt: number;
  closedBy: string | null;
  paidToRecipient: bigint;
  paidToPayer: bigint;
  updatedLedger: number;
}

export interface EscrowView {
  escrow: Escrow;
  deadlinePassed: boolean;
}

export interface PendingUpgrade {
  hash: string;
  eta: number;
  expiresAt: number;
}

export interface ContractInfo {
  version: number;
  storageVersion: number;
  admin: string;
  pendingAdmin: string | null;
  token: string;
  paused: boolean;
  upgradesLocked: boolean;
  escrowCount: bigint;
  totalLocked: bigint;
  upgradeDelay: number;
  pendingUpgrade: PendingUpgrade | null;
}

export type EscrowAction =
  | "created"
  | "funded"
  | "released"
  | "refunded"
  | "reclaimed"
  | "disputed"
  | "resolved"
  | "cancelled";

export interface EscrowEvent {
  /** RPC event id, or "stored:<action>" for rows rebuilt from the record. */
  id: string;
  action: EscrowAction;
  /** Null for rows rebuilt from the stored record. */
  txHash: string | null;
  ledger: number | null;
  /** Unix seconds. */
  at: number;
  /** Who signed: an address, when known. */
  by: string | null;
  data: Record<string, unknown>;
}

export interface EscrowHistory {
  events: EscrowEvent[];
  /** Some steps are older than the RPC keeps, or missing from it. */
  truncated: boolean;
}

/** Who the connected wallet is on one escrow. */
export type Role = "guest" | "payer" | "recipient" | "arbiter" | "stranger";
