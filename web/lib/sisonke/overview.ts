/**
 * The connected wallet's escrows across its three roles, for Overview and
 * Escrows: who needs to act, the totals, the filters and the activity feed.
 * Pure: everything comes from fresh `get_escrows` reads (INTEGRATION §3),
 * money is bigint stroops.
 */
import { formatShort } from "../format";
import { actionsFor } from "./actions";
import { disputeWindowOpen } from "./deadline";
import { roleOf } from "./role";
import { likelySpam } from "./spam";
import { closedByRole } from "./status";
import { isFinal, isLocked, type EscrowView } from "./types";

export type MyRole = "payer" | "recipient" | "arbiter";

export interface Mine {
  view: EscrowView;
  role: MyRole;
}

export interface Clock {
  ledgerNow: number | null;
  paused: boolean;
}

export const ROLE_LABEL: Record<MyRole, string> = { payer: "Paying", recipient: "Receiving", arbiter: "Arbiter" };

const TAB = { payer: "paying", recipient: "receiving", arbiter: "arbiter" } as const;

/**
 * One row per escrow (an id read for two roles is kept once), newest first.
 * Hidden ids and likely spam go to `collapsed` (a view preference only).
 */
export function collect(address: string, views: EscrowView[], hidden: Set<string>) {
  const seen = new Map<string, Mine>();
  for (const v of views) {
    const id = v.escrow.id.toString();
    if (seen.has(id)) continue;
    const role = roleOf(v.escrow, address);
    if (role === "payer" || role === "recipient" || role === "arbiter") seen.set(id, { view: v, role });
  }
  const all = [...seen.values()].sort((a, b) => (a.view.escrow.id < b.view.escrow.id ? 1 : -1));
  const visible: Mine[] = [];
  const collapsed: Mine[] = [];
  let spam = 0;
  for (const m of all) {
    const id = m.view.escrow.id.toString();
    const isSpam = likelySpam(m.view.escrow, address, TAB[m.role]);
    if (hidden.has(id) || isSpam) {
      collapsed.push(m);
      if (isSpam && !hidden.has(id)) spam++;
    } else visible.push(m);
  }
  return { visible, collapsed, spam };
}

/**
 * The action matrix says it's this wallet's move: the payer can deposit,
 * release, reclaim, or must cancel a deposit that came too late; the arbiter
 * can decide a dispute. A recipient's refund or a dispute is a way out, not a
 * pending move.
 */
export function needsAction({ view, role }: Mine, clock: Clock): boolean {
  const e = view.escrow;
  const { allowed } = actionsFor({
    status: e.status,
    role,
    deadlinePassed: view.deadlinePassed,
    hasArbiter: !!e.arbiter,
    disputeWindowOpen: disputeWindowOpen(e.deadline, clock.ledgerNow),
    paused: clock.paused,
  });
  if (role === "arbiter") return allowed.includes("resolve");
  if (role !== "payer") return false;
  if (allowed.includes("fund") || allowed.includes("reclaim")) return true;
  if (e.status === "Funded" && allowed.includes("release")) return true;
  return e.status === "Created" && view.deadlinePassed && allowed.includes("cancel");
}

export interface Totals {
  need: number;
  /** Locked by this wallet as payer: Funded and Disputed. */
  youLocked: bigint;
  /** Locked with this wallet as recipient: Funded and Disputed. */
  lockedForYou: bigint;
  completed: number;
}

export function totals(list: Mine[], clock: Clock): Totals {
  let need = 0;
  let youLocked = 0n;
  let lockedForYou = 0n;
  let completed = 0;
  for (const m of list) {
    const e = m.view.escrow;
    if (needsAction(m, clock)) need++;
    if (isLocked(e.status)) {
      if (m.role === "payer") youLocked += e.amount;
      if (m.role === "recipient") lockedForYou += e.amount;
    }
    if (isFinal(e.status)) completed++;
  }
  return { need, youLocked, lockedForYou, completed };
}

export type Filter = "open" | "need" | "paying" | "receiving" | "closed";

export const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "need", label: "Needs action" },
  { value: "paying", label: "Paying" },
  { value: "receiving", label: "Receiving" },
  { value: "closed", label: "Closed" },
];

export function matches(f: Filter, m: Mine, clock: Clock): boolean {
  const s = m.view.escrow.status;
  switch (f) {
    case "open":
      return !isFinal(s);
    case "need":
      return needsAction(m, clock);
    case "paying":
      return m.role === "payer";
    case "receiving":
      return m.role === "recipient";
    case "closed":
      return isFinal(s);
  }
}

/** The Deadline column: the deadline while open, the closing day once closed. */
export function whenText({ view, role }: Mine): string {
  const e = view.escrow;
  if (isFinal(e.status)) return e.closedAt > 0 ? formatShort(e.closedAt) : "Closed";
  if (role === "arbiter" && e.status === "Disputed") return "Decide now";
  if (view.deadlinePassed) return "Passed";
  return formatShort(e.deadline);
}

export interface Activity {
  id: string;
  /** The escrow's title (untrusted: render as text through displayTitle). */
  title: string;
  /** "Paid to you", "You released"… */
  what: string;
  at: number;
  amount: bigint;
  /** "+" paid to you, "-" paid away from you, "" nothing moved to or from you. */
  sign: "+" | "-" | "";
}

/**
 * The latest change on one escrow, seen from this wallet. Created escrows
 * have no money movement yet and are left out.
 */
export function activityOf({ view, role }: Mine): Activity | null {
  const e = view.escrow;
  const by = closedByRole(e);
  const row = (what: string, at: number, amount: bigint, sign: Activity["sign"]): Activity => ({
    id: e.id.toString(),
    title: e.title,
    what,
    at,
    amount,
    sign,
  });
  switch (e.status) {
    case "Created":
      return null;
    case "Funded":
      if (role === "payer") return row("You locked it", e.fundedAt, e.amount, "-");
      return row(role === "recipient" ? "Locked for you" : "Locked", e.fundedAt, e.amount, "");
    case "Disputed":
      return row(e.disputedBy && roleOf(e, e.disputedBy) === role ? "You opened a dispute" : "Dispute opened", e.disputedAt, e.amount, "");
    case "Released":
      if (role === "recipient") return row("Paid to you", e.closedAt, e.amount, "+");
      if (role === "payer") return row(by === "arbiter" ? "Released by the arbiter" : "You released", e.closedAt, e.amount, "-");
      return row("You decided: all to the recipient", e.closedAt, e.amount, "");
    case "Refunded":
      if (role === "payer") {
        const what = by === "payer" ? "You reclaimed it" : by === "arbiter" ? "Returned by the arbiter" : "Refunded to you";
        return row(what, e.closedAt, e.amount, "+");
      }
      if (role === "recipient") return row(by === "recipient" ? "You refunded it" : by === "payer" ? "The payer reclaimed it" : "Returned to the payer", e.closedAt, e.amount, "");
      return row("You decided: all to the payer", e.closedAt, e.amount, "");
    case "Split":
      if (role === "payer") return row("Split · part back to you", e.closedAt, e.paidToPayer, "+");
      if (role === "recipient") return row("Split · paid to you", e.closedAt, e.paidToRecipient, "+");
      return row("You split it", e.closedAt, e.amount, "");
    case "Cancelled":
      return row(role === "payer" ? "You cancelled it" : "Cancelled", e.closedAt, 0n, "");
  }
}

/** The newest changes first. */
export function recentActivity(list: Mine[], n = 5): Activity[] {
  return list
    .map(activityOf)
    .filter((a): a is Activity => !!a && a.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, n);
}
