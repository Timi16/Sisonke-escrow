/** Escrow-page words: button labels, notes, the confirm step and the move card (docs/design/app). */
import { formatDayName, shortAddress } from "../format";
import type { ActionId } from "./actions";
import { formatUsdc } from "./amount";
import { isFinal, type Escrow, type Role } from "./types";

export function actionLabel(id: ActionId, e: Escrow): string {
  const x = formatUsdc(e.amount);
  switch (id) {
    case "fund":
      return `Deposit ${x} USDC`;
    case "cancel":
      return "Cancel escrow";
    case "release":
      return `Release ${x} USDC`;
    case "refund":
      return "Refund payer";
    case "reclaim":
      return `Reclaim ${x} USDC`;
    case "dispute":
      return "Open a dispute";
    case "resolve":
      return "Decide this split";
  }
}

/** The short line under each action button. */
export function actionDescription(id: ActionId, e: Escrow): string {
  const x = formatUsdc(e.amount);
  switch (id) {
    case "fund":
      return `Moves ${x} USDC from your wallet into the contract.`;
    case "cancel":
      return "Closes it. Nothing was deposited, so nothing moves.";
    case "release":
      return `Sends all ${x} USDC to ${shortAddress(e.recipient)}.`;
    case "refund":
      return `Returns all ${x} USDC to the payer.`;
    case "reclaim":
      return `The deadline has passed. Sends all ${x} USDC back to you.`;
    case "dispute":
      return "The arbiter decides. Nothing moves yet.";
    case "resolve":
      return "Splits the USDC as set above.";
  }
}

export interface Confirm {
  question: string;
  /** "This can't be undone." or what happens next. */
  note: string;
  yes: string;
}

/** The confirm step before the wallet opens. `recipientShare` only for resolve. */
export function confirmOf(id: ActionId, e: Escrow, recipientShare = 0n): Confirm {
  const x = formatUsdc(e.amount);
  const final = "This can’t be undone.";
  switch (id) {
    case "fund":
      return { question: `Deposit ${x} USDC into the contract?`, note: "It stays locked until released, refunded or reclaimed.", yes: "Yes, deposit" };
    case "cancel":
      return { question: "Cancel this escrow? Nothing was deposited.", note: final, yes: "Yes, cancel it" };
    case "release":
      return { question: `Send ${x} USDC to ${shortAddress(e.recipient)}?`, note: final, yes: "Yes, release it" };
    case "refund":
      return { question: `Refund ${x} USDC to ${shortAddress(e.payer)}?`, note: final, yes: "Yes, refund" };
    case "reclaim":
      return { question: `Take back ${x} USDC?`, note: final, yes: "Yes, reclaim it" };
    case "dispute":
      return { question: "Open a dispute? The arbiter will decide the split.", note: `${final} The payer can't reclaim after this.`, yes: "Yes, open it" };
    case "resolve":
      return {
        question: `Split it ${formatUsdc(recipientShare)} to the recipient and ${formatUsdc(e.amount - recipientShare)} to the payer?`,
        note: final,
        yes: "Yes, split it",
      };
  }
}

/** Labels in the "Check other actions" list. */
export const BLOCKED_LABEL: Record<ActionId, string> = {
  fund: "Deposit",
  release: "Release",
  refund: "Refund",
  reclaim: "Reclaim after the deadline",
  dispute: "Open a dispute",
  resolve: "Decide the dispute",
  cancel: "Cancel",
};

export interface Heading {
  heading: string;
  intro: string;
}

/** Title and line of the move card. */
export function cardHeading(e: Escrow, role: Role, deadlinePassed: boolean): Heading {
  const day = formatDayName(e.deadline);
  if (isFinal(e.status)) return { heading: "Closed for good", intro: "This escrow is settled." };
  if (role === "guest") return { heading: "View only", intro: "Connect a party wallet to act." };
  if (role === "stranger") return { heading: "View only", intro: "This wallet isn’t part of this escrow." };
  if (role === "payer") {
    if (e.status === "Created") {
      return deadlinePassed
        ? { heading: "Too late to deposit", intro: "The deadline passed before it was funded. Cancel it to close it." }
        : { heading: "Your move", intro: "Deposit so the recipient can see the money is locked." };
    }
    if (e.status === "Funded") {
      return { heading: "Your move", intro: deadlinePassed ? "The deadline has passed. Release it, or take it back." : "Release when the work is delivered." };
    }
    return { heading: "In dispute", intro: "The arbiter decides. You can still release in full." };
  }
  if (role === "recipient") {
    if (e.status === "Created") return { heading: "Waiting on the payer", intro: "Nothing is locked yet. Don’t start work until it says Locked." };
    if (e.status === "Funded") {
      return {
        heading: "Locked for you",
        intro: deadlinePassed ? "The deadline has passed, so the payer can take it back." : "You’re paid when the payer releases. Don’t recognise it? Refund it.",
      };
    }
    return { heading: "In dispute", intro: "The arbiter decides. You can still refund in full." };
  }
  if (e.status === "Disputed") return { heading: "Decide the split", intro: "Choose the recipient’s share." };
  return { heading: "Nothing to decide", intro: `You act only if a dispute opens before ${day}.` };
}
