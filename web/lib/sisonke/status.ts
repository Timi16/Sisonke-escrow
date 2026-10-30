/**
 * How each status is presented: chip labels, the "where the money is" card
 * and its one-line story. Everything here derives from the chain read
 * (INTEGRATION §3).
 */
import { formatUsdc } from "./amount";
import type { Escrow, EscrowView, Status } from "./types";

/** Chip labels on the website (landing, rules). */
export const STATUS_LABEL: Record<Status, string> = {
  Created: "Awaiting deposit — not funded",
  Funded: "Funded",
  Disputed: "In dispute",
  Released: "Released",
  Refunded: "Refunded",
  Split: "Split",
  Cancelled: "Cancelled",
};

/**
 * Chip labels in the app (docs/design/app): Funded reads "Locked". Created keeps
 * "— not funded" because INTEGRATION §3 requires it wherever the status shows.
 */
export const APP_STATUS_LABEL: Record<Status, string> = { ...STATUS_LABEL, Funded: "Locked" };

export const DEADLINE_PASSED_LABEL = "Deadline passed";

/** The "Deadline passed" modifier chip shows on open, deadline-bound statuses. */
export const showsDeadlinePassed = (view: EscrowView) =>
  view.deadlinePassed && (view.escrow.status === "Created" || view.escrow.status === "Funded");

/** Who closed it, as a role. */
export function closedByRole(e: Escrow): "payer" | "recipient" | "arbiter" | null {
  if (!e.closedBy) return null;
  if (e.closedBy === e.payer) return "payer";
  if (e.closedBy === e.recipient) return "recipient";
  if (e.arbiter && e.closedBy === e.arbiter) return "arbiter";
  return null;
}

export type HoldTone = "awaiting" | "lime" | "violet" | "ink" | "line" | "split" | "muted";

export interface MoneyCard {
  /** The pill's label: "In escrow", "In dispute", "Released"… */
  label: string;
  tone: HoldTone;
  /** The figure in the pill. Created and Cancelled show 0: nothing is or was locked. */
  shown: bigint;
  /** Under the figure. */
  unit: string;
  /** The rings that hold the money now. */
  payerLit: boolean;
  recipientLit: boolean;
}

/** The "where the money is" card: payer ring, the pill, recipient ring. */
export function moneyCard(e: Escrow): MoneyCard {
  const base = { unit: "USDC", payerLit: false, recipientLit: false };
  switch (e.status) {
    case "Created":
      return { ...base, label: "Awaiting deposit", tone: "awaiting", shown: 0n, unit: "USDC · nothing locked yet" };
    case "Funded":
      return { ...base, label: "In escrow", tone: "lime", shown: e.amount };
    case "Disputed":
      return { ...base, label: "In dispute", tone: "violet", shown: e.amount };
    case "Released":
      return { ...base, label: "Released", tone: "ink", shown: e.amount, recipientLit: true };
    case "Refunded":
      return { ...base, label: "Refunded", tone: "line", shown: e.amount, payerLit: true };
    case "Split":
      return { ...base, label: "Split", tone: "split", shown: e.amount, payerLit: true, recipientLit: true };
    case "Cancelled":
      return { ...base, label: "Cancelled", tone: "muted", shown: 0n, unit: "USDC · nothing ever moved" };
  }
}

/** The one-line story under the money card (and on Find results). */
export function statusSentence(view: EscrowView): string {
  const e = view.escrow;
  switch (e.status) {
    case "Created":
      return "Nothing locked yet. Waiting for the payer's deposit.";
    case "Funded":
      return view.deadlinePassed
        ? "Locked in the contract. The deadline has passed, so the payer can also take it back."
        : "Locked in the contract until released or refunded.";
    case "Disputed":
      return "In dispute. The arbiter decides the split.";
    case "Released":
      return closedByRole(e) === "arbiter" ? "Released to the recipient by the arbiter. Closed." : "Released to the recipient. Closed.";
    case "Refunded": {
      const by = closedByRole(e);
      if (by === "recipient") return "Refunded to the payer. The recipient refunded it. Closed.";
      if (by === "payer") return "Back with the payer. The payer reclaimed it after the deadline. Closed.";
      if (by === "arbiter") return "Refunded to the payer. The arbiter decided it. Closed.";
      return "Refunded to the payer. Closed.";
    }
    case "Split":
      return `Split ${formatUsdc(e.paidToRecipient)} to the recipient, ${formatUsdc(e.paidToPayer)} to the payer. Closed.`;
    case "Cancelled":
      return "Cancelled before any deposit. No money ever moved.";
  }
}

export type Tab = "paying" | "receiving" | "arbiter";
