/**
 * Role × status × time → what the viewer may do (CONTRACT.md "Who may do
 * what", WEB_PLAN §6.2). Pure and exhaustively unit-tested. Time comes from
 * the chain read (`deadline_passed`) and the ledger clock, never the browser
 * clock alone.
 */
import { isFinal, type Role, type Status } from "./types";

export type ActionId = "fund" | "cancel" | "release" | "refund" | "reclaim" | "dispute" | "resolve";

export interface Ctx {
  status: Status;
  role: Role;
  deadlinePassed: boolean;
  hasArbiter: boolean;
  /** ledgerNow < deadline - DISPUTE_CUTOFF */
  disputeWindowOpen: boolean;
  paused: boolean;
  /** Formatted deadline for "Opens on <D> if still locked." */
  deadlineText?: string;
}

export interface Blocked {
  id: ActionId;
  why: string;
}

export interface Actions {
  allowed: ActionId[];
  /** Which allowed actions are the primary (lime) button. */
  primary: ActionId[];
  blocked: Blocked[];
}

const SIGNER: Record<ActionId, "payer" | "recipient" | "arbiter" | "party"> = {
  fund: "payer",
  cancel: "payer",
  release: "payer",
  refund: "recipient",
  reclaim: "payer",
  dispute: "party",
  resolve: "arbiter",
};

function allowedFor(ctx: Ctx): ActionId[] {
  const { status, role, deadlinePassed, hasArbiter, disputeWindowOpen, paused } = ctx;
  const out: ActionId[] = [];
  const canDispute = hasArbiter && disputeWindowOpen && !deadlinePassed;
  if (role === "payer") {
    if (status === "Created") {
      if (!deadlinePassed && !paused) out.push("fund");
      out.push("cancel");
    } else if (status === "Funded") {
      out.push("release");
      if (deadlinePassed) out.push("reclaim");
      else if (canDispute) out.push("dispute");
    } else if (status === "Disputed") {
      out.push("release");
    }
  } else if (role === "recipient") {
    if (status === "Funded") {
      out.push("refund");
      if (!deadlinePassed && canDispute) out.push("dispute");
    } else if (status === "Disputed") {
      out.push("refund");
    }
  } else if (role === "arbiter") {
    if (status === "Disputed" && hasArbiter) out.push("resolve");
  }
  return out;
}

const PRIMARY: ActionId[] = ["fund", "release", "refund", "reclaim", "resolve"];

function wrongSigner(id: ActionId, role: Role): string | null {
  const signer = SIGNER[id];
  if (signer === "party") {
    if (role === "payer" || role === "recipient") return null;
    return role === "stranger" ? "You're not part of this escrow." : "Only the payer or the recipient can do this.";
  }
  if (role === signer) return null;
  if (role === "stranger") return "You're not part of this escrow.";
  return `Only the ${signer} can do this.`;
}

function reasonFor(id: ActionId, ctx: Ctx): string {
  const { status, role, deadlinePassed, disputeWindowOpen, paused } = ctx;
  if (isFinal(status)) return "This escrow is closed.";
  const signer = wrongSigner(id, role);
  if (signer) return signer;
  switch (id) {
    case "fund":
      if (status !== "Created") return "Already deposited.";
      if (deadlinePassed) return "The deadline has passed.";
      if (paused) return "Deposits are paused right now.";
      break;
    case "cancel":
      if (status !== "Created") return "Already deposited.";
      break;
    case "release":
    case "refund":
      if (status === "Created") return "Deposit first. Nothing is locked yet.";
      break;
    case "reclaim":
      if (status === "Created") return "Deposit first. Nothing is locked yet.";
      if (status === "Disputed") return "A dispute is open, so the arbiter decides.";
      if (!deadlinePassed) return `Opens on ${ctx.deadlineText ?? "the deadline"} if still locked.`;
      break;
    case "dispute":
      if (status === "Created") return "Nothing is locked yet.";
      if (status === "Disputed") return "A dispute is already open.";
      if (deadlinePassed) return "The deadline has passed.";
      if (!disputeWindowOpen) return "Disputes close 10 minutes before the deadline, so one can't land too late.";
      break;
    case "resolve":
      if (status !== "Disputed") return "Only after someone opens a dispute.";
      break;
  }
  return "The contract doesn't allow this right now.";
}

/** Everything the action card and the "Not yours to do" list need. */
export function actionsFor(ctx: Ctx): Actions {
  if (ctx.role === "guest") return { allowed: [], primary: [], blocked: [] };
  const allowed = allowedFor(ctx);
  const candidates: ActionId[] = ["fund", "release", "refund", "reclaim"];
  if (ctx.hasArbiter) candidates.push("dispute", "resolve");
  if (ctx.status === "Created") candidates.push("cancel");
  const blocked = candidates.filter((id) => !allowed.includes(id)).map((id) => ({ id, why: reasonFor(id, ctx) }));
  const ordered = [...allowed.filter((a) => PRIMARY.includes(a)), ...allowed.filter((a) => !PRIMARY.includes(a))];
  return { allowed: ordered, primary: ordered.filter((a) => PRIMARY.includes(a)), blocked };
}

/** Which role the contract requires for an action (for "Try anyway" copy). */
export const signerOf = (id: ActionId) => SIGNER[id];
