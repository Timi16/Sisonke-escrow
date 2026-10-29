/** Action-card words: labels, descriptions, headings and intros (WEB_PLAN §6.3, §6.4). */
import { shortAddress } from "../format";
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
      return "Release to recipient";
    case "refund":
      return "Refund to payer";
    case "reclaim":
      return `Reclaim ${x} USDC`;
    case "dispute":
      return "Open a dispute";
    case "resolve":
      return "Confirm decision";
  }
}

export function actionDescription(id: ActionId, e: Escrow): string {
  const x = formatUsdc(e.amount);
  const disputed = e.status === "Disputed";
  switch (id) {
    case "fund":
      return "Moves the USDC from your wallet into the contract. The recipient can then see it's locked.";
    case "cancel":
      return "Closes it for good. Nothing was deposited, so nothing moves.";
    case "release":
      return disputed
        ? `Ends the dispute and sends all ${x} USDC to the recipient. This can't be undone.`
        : `Sends all ${x} USDC to the recipient. This can't be undone.`;
    case "refund":
      return disputed
        ? `Ends the dispute and sends all ${x} USDC back to the payer.`
        : `Sends all ${x} USDC back to the payer. This can't be undone.`;
    case "reclaim":
      return `The deadline has passed. Sends all ${x} USDC back to you. This can't be undone.`;
    case "dispute":
      return `Hands the decision to the arbiter ${e.arbiter ? shortAddress(e.arbiter) : ""}. Nothing moves now. After this the payer can't reclaim, and the arbiter decides how to split it.`.replace("  ", " ");
    case "resolve":
      return "Divides the USDC as set above. It's final.";
  }
}

/** Labels in the "Not yours to do" list. */
export const BLOCKED_LABEL: Record<ActionId, string> = {
  fund: "Deposit",
  release: "Release",
  refund: "Refund",
  reclaim: "Reclaim after the deadline",
  dispute: "Open a dispute",
  resolve: "Decide the dispute",
  cancel: "Cancel",
};

/** Verbs for "Nothing is locked yet, so there's nothing to <verb>." */
export const ACTION_VERB: Partial<Record<string, string>> = {
  release: "release",
  refund: "refund",
  reclaim: "take back",
  fund: "deposit",
  cancel: "cancel",
  dispute: "dispute",
  resolve: "decide",
};

export interface Heading {
  heading: string;
  intro: string;
}

/** Heading and intro of the action card. */
export function cardHeading(e: Escrow, role: Role, deadlinePassed: boolean): Heading {
  const x = formatUsdc(e.amount);
  const arb = e.arbiter ? shortAddress(e.arbiter) : "";
  if (role === "guest") {
    return {
      heading: "Connect to act",
      intro:
        "Anyone with this link can watch the escrow. To deposit, release or refund, connect the wallet that's part of it. The contract will recognise it.",
    };
  }
  if (isFinal(e.status)) {
    return { heading: "Nothing left to do", intro: "This escrow is closed. The contract won't accept another release or refund." };
  }
  if (role === "payer") {
    if (e.status === "Created") {
      return deadlinePassed
        ? {
            heading: "Too late to deposit",
            intro: "The deadline passed before this was funded, so the contract won't take a deposit. Cancel it to close it.",
          }
        : { heading: "Your move", intro: "Deposit the USDC so the recipient can see it's locked before they start." };
    }
    if (e.status === "Funded") {
      return {
        heading: "Your move",
        intro: deadlinePassed
          ? "The deadline has passed. Release it if the work arrived, or take it back."
          : "Release the money once you're happy with the work.",
      };
    }
    return {
      heading: "In dispute",
      intro: `The arbiter ${arb} decides how to split it. You can still release it all to the recipient.`,
    };
  }
  if (role === "recipient") {
    if (e.status === "Created") {
      return { heading: "Waiting on the payer", intro: "Nothing is locked yet. Don't start work until the status says Funded." };
    }
    if (e.status === "Funded") {
      return {
        heading: "Your move",
        intro:
          "It's locked. Safe to start work. If the deal falls through, send the money back to the payer. Don't recognise this escrow? Refund it." +
          (deadlinePassed ? " The deadline has passed, so the payer can now take it back." : ""),
      };
    }
    return { heading: "In dispute", intro: "The arbiter decides how to split it. You can still refund it all to the payer." };
  }
  if (role === "arbiter") {
    if (e.status === "Disputed") {
      return { heading: "Your decision", intro: `Divide the ${x} USDC between the payer and the recipient. It's final.` };
    }
    return {
      heading: "Nothing for you yet",
      intro: "As the arbiter you can act only if the payer or the recipient opens a dispute.",
    };
  }
  return {
    heading: "Just looking",
    intro: `Only the payer and the recipient${e.arbiter ? ", and the arbiter in a dispute," : ""} can act on this escrow. The contract rejects anyone else's signature.`,
  };
}
