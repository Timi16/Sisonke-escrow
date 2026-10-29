/**
 * How each status is presented: chip label, where the money is, the sentence
 * under the money strip, the progress steps and dashboard row hints.
 * Everything here derives from the chain read (INTEGRATION §3).
 */
import { formatUsdc } from "./amount";
import type { Escrow, EscrowView, Role, Status } from "./types";

export const STATUS_LABEL: Record<Status, string> = {
  Created: "Awaiting deposit — not funded",
  Funded: "Funded",
  Disputed: "In dispute",
  Released: "Released",
  Refunded: "Refunded",
  Split: "Split",
  Cancelled: "Cancelled",
};
export const DEADLINE_PASSED_LABEL = "Deadline passed";

/** The "Deadline passed" modifier chip shows on open, deadline-bound statuses. */
export const showsDeadlinePassed = (view: EscrowView) =>
  view.deadlinePassed && (view.escrow.status === "Created" || view.escrow.status === "Funded");

export type Cell = "payer" | "contract" | "recipient";

export interface MoneyPosition {
  /** CSS left of the coin, as a percentage string. */
  coinLeft: string;
  coinFaded: boolean;
  /** Highlighted cells and their fill. */
  highlight: Partial<Record<Cell, "ground" | "lime" | "lilac">>;
  /** What the contract holds for this escrow right now. */
  contractHolds: bigint;
  caption: string;
}

export function moneyPosition(e: Escrow): MoneyPosition {
  switch (e.status) {
    case "Created":
      return { coinLeft: "16.66%", coinFaded: false, highlight: { payer: "ground" }, contractHolds: 0n, caption: "Nothing locked yet" };
    case "Funded":
      return { coinLeft: "50%", coinFaded: false, highlight: { contract: "lime" }, contractHolds: e.amount, caption: "Locked until released or refunded" };
    case "Disputed":
      return { coinLeft: "50%", coinFaded: false, highlight: { contract: "lilac" }, contractHolds: e.amount, caption: "In dispute" };
    case "Released":
      return { coinLeft: "83.33%", coinFaded: false, highlight: { recipient: "ground" }, contractHolds: 0n, caption: "Paid out to the recipient" };
    case "Refunded":
      return { coinLeft: "16.66%", coinFaded: false, highlight: { payer: "ground" }, contractHolds: 0n, caption: "Returned to the payer" };
    case "Split":
      return { coinLeft: "50%", coinFaded: true, highlight: { payer: "ground", recipient: "ground" }, contractHolds: 0n, caption: "Split by the arbiter" };
    case "Cancelled":
      return { coinLeft: "16.66%", coinFaded: false, highlight: {}, contractHolds: 0n, caption: "Nothing ever locked" };
  }
}

/** Who closed it, as a role. */
export function closedByRole(e: Escrow): "payer" | "recipient" | "arbiter" | null {
  if (!e.closedBy) return null;
  if (e.closedBy === e.payer) return "payer";
  if (e.closedBy === e.recipient) return "recipient";
  if (e.arbiter && e.closedBy === e.arbiter) return "arbiter";
  return null;
}

/** The sentence under the money strip. */
export function statusSentence(view: EscrowView, viewer: Role = "guest"): string {
  const e = view.escrow;
  const x = `${formatUsdc(e.amount)} USDC`;
  switch (e.status) {
    case "Created":
      return `Waiting for ${viewer === "payer" ? "you" : "the payer"} to deposit ${x}. Nothing is locked yet.`;
    case "Funded":
      return (
        `${x} is locked in the contract. It moves only when the payer releases it or the recipient refunds it` +
        `${e.arbiter ? ", or the arbiter decides a dispute" : ""}.` +
        (view.deadlinePassed ? " The deadline has passed, so the payer can also take it back." : "")
      );
    case "Disputed":
      return `${x} is locked and in dispute. The arbiter decides how to split it. The payer can still release it, or the recipient can still refund it.`;
    case "Released":
      return `${x} was paid to the recipient${closedByRole(e) === "arbiter" ? ", by the arbiter's decision" : ""}. This escrow is closed for good.`;
    case "Refunded": {
      const how =
        closedByRole(e) === "recipient"
          ? " The recipient refunded it."
          : closedByRole(e) === "payer"
            ? " The payer reclaimed it after the deadline."
            : closedByRole(e) === "arbiter"
              ? " The arbiter decided it."
              : "";
      return `${x} went back to the payer.${how} This escrow is closed for good.`;
    }
    case "Split":
      return `The arbiter divided it: ${formatUsdc(e.paidToRecipient)} USDC to the recipient, ${formatUsdc(e.paidToPayer)} USDC to the payer. Closed for good.`;
    case "Cancelled":
      return "The payer cancelled it before depositing. No money ever moved.";
  }
}

export interface ProgressStep {
  label: string;
  state: "done" | "current" | "todo";
  /** Violet mark for the dispute step. */
  dispute?: boolean;
}

/** Created → Funded → final (Cancelled: Created → Cancelled). */
export function progressSteps(status: Status): ProgressStep[] {
  if (status === "Cancelled") {
    return [
      { label: "Created", state: "done" },
      { label: "Cancelled", state: "current" },
    ];
  }
  const index = status === "Created" ? 0 : status === "Funded" || status === "Disputed" ? 1 : 2;
  const third = status === "Released" || status === "Refunded" || status === "Split" ? status : "Released or refunded";
  const labels = ["Created", status === "Disputed" ? "In dispute" : "Funded", third];
  return labels.map((label, i) => ({
    label,
    state: i < index ? "done" : i === index ? "current" : "todo",
    dispute: i === 1 && status === "Disputed",
  }));
}

export type Tab = "paying" | "receiving" | "arbiter";

export interface RowHint {
  text: string;
  needsYou: boolean;
}

/** The hint on a dashboard row (WEB_PLAN §3.3). */
export function rowHint(view: EscrowView, tab: Tab): RowHint {
  const e = view.escrow;
  const past = view.deadlinePassed;
  const by = closedByRole(e);
  if (tab === "paying") {
    switch (e.status) {
      case "Created":
        return past ? { text: "Too late to deposit. Cancel it", needsYou: true } : { text: "Deposit to lock it", needsYou: true };
      case "Funded":
        return past
          ? { text: "Deadline passed. Release or reclaim", needsYou: true }
          : { text: "Release when the work is in", needsYou: true };
      case "Disputed":
        return { text: "In dispute. The arbiter decides", needsYou: false };
      case "Released":
        return { text: "Paid out", needsYou: false };
      case "Refunded":
        return {
          text: by === "recipient" ? "Came back to you" : by === "payer" ? "You took it back" : "The arbiter returned it",
          needsYou: false,
        };
      case "Split":
        return { text: "Split by the arbiter", needsYou: false };
      case "Cancelled":
        return { text: "Cancelled", needsYou: false };
    }
  }
  if (tab === "receiving") {
    switch (e.status) {
      case "Created":
        return { text: "Waiting on the payer", needsYou: false };
      case "Funded":
        return past
          ? { text: "Deadline passed. The payer can take it back", needsYou: false }
          : { text: "Locked. Safe to start work", needsYou: true };
      case "Disputed":
        return { text: "In dispute. The arbiter decides", needsYou: false };
      case "Released":
        return { text: "You got paid", needsYou: false };
      case "Refunded":
        return {
          text: by === "recipient" ? "You sent it back" : by === "payer" ? "The payer took it back" : "The arbiter returned it",
          needsYou: false,
        };
      case "Split":
        return { text: "Split by the arbiter", needsYou: false };
      case "Cancelled":
        return { text: "Cancelled", needsYou: false };
    }
  }
  switch (e.status) {
    case "Disputed":
      return { text: "Your decision", needsYou: true };
    case "Created":
    case "Funded":
      return { text: "No dispute", needsYou: false };
    default:
      return { text: "Closed", needsYou: false };
  }
}
