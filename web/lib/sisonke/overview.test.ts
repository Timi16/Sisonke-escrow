import { describe, expect, test } from "vitest";
import { ARBITER, PAYER, RECIPIENT, STRANGER, view } from "@/tests/fixtures";
import { activityOf, collect, matches, needsAction, recentActivity, totals, whenText, type Mine } from "./overview";
import type { Escrow } from "./types";

const clock = { ledgerNow: 1_790_000_500, paused: false };
const mine = (role: Mine["role"], over: Partial<Escrow> = {}, passed = false): Mine => ({ role, view: view(over, passed) });

describe("needs action (the action matrix's own move)", () => {
  test("payer: deposit, release, reclaim, or cancel a deposit that came too late", () => {
    expect(needsAction(mine("payer", { status: "Created" }), clock)).toBe(true);
    expect(needsAction(mine("payer", { status: "Funded" }), clock)).toBe(true);
    expect(needsAction(mine("payer", { status: "Funded" }, true), clock)).toBe(true);
    expect(needsAction(mine("payer", { status: "Created" }, true), clock)).toBe(true);
    expect(needsAction(mine("payer", { status: "Disputed", arbiter: ARBITER }), clock)).toBe(false);
    expect(needsAction(mine("payer", { status: "Released" }), clock)).toBe(false);
  });
  test("paused: a deposit isn't a move, cancelling an open one isn't either", () => {
    expect(needsAction(mine("payer", { status: "Created" }), { ...clock, paused: true })).toBe(false);
  });
  test("recipient: refunding or disputing is a way out, not a pending move", () => {
    expect(needsAction(mine("recipient", { status: "Funded" }), clock)).toBe(false);
    expect(needsAction(mine("recipient", { status: "Disputed", arbiter: ARBITER }), clock)).toBe(false);
  });
  test("arbiter: only a dispute", () => {
    expect(needsAction(mine("arbiter", { status: "Disputed", arbiter: ARBITER }), clock)).toBe(true);
    expect(needsAction(mine("arbiter", { status: "Funded", arbiter: ARBITER }), clock)).toBe(false);
  });
});

describe("totals (bigint stroops)", () => {
  test("sums locked money by side and counts closed escrows", () => {
    const list = [
      mine("payer", { id: 1n, status: "Funded", amount: 2_500_000_000n }),
      mine("payer", { id: 2n, status: "Disputed", arbiter: ARBITER, amount: 1n }),
      mine("payer", { id: 3n, status: "Created", amount: 9_000_000_000n }),
      mine("recipient", { id: 4n, status: "Funded", amount: 6_000_000_001n }),
      mine("recipient", { id: 5n, status: "Released", amount: 3_500_000_000n }),
      mine("payer", { id: 6n, status: "Cancelled" }),
      mine("arbiter", { id: 7n, status: "Disputed", arbiter: ARBITER, amount: 900_000_000n }),
    ];
    expect(totals(list, clock)).toEqual({ need: 3, youLocked: 2_500_000_001n, lockedForYou: 6_000_000_001n, completed: 2 });
  });
  test("an awaiting-deposit escrow is never counted as locked", () => {
    expect(totals([mine("payer", { status: "Created" })], clock).youLocked).toBe(0n);
  });
  test("empty", () => {
    expect(totals([], clock)).toEqual({ need: 0, youLocked: 0n, lockedForYou: 0n, completed: 0 });
  });
});

describe("collect", () => {
  test("one row per id with the strongest role, newest first; spam and hidden collapse", () => {
    const own = view({ id: 1n });
    const spam = view({ id: 2n, payer: STRANGER, amount: 1n });
    const hidden = view({ id: 3n });
    const other = view({ id: 4n, payer: STRANGER, recipient: ARBITER });
    const out = collect(PAYER, [own, own, hidden, other], new Set(["3"]));
    expect(out.visible.map((m) => [m.view.escrow.id, m.role])).toEqual([[1n, "payer"]]);
    expect(out.collapsed.map((m) => m.view.escrow.id)).toEqual([3n]);
    const r = collect(RECIPIENT, [spam], new Set());
    expect(r.visible).toEqual([]);
    expect(r.spam).toBe(1);
  });
});

describe("filters and the deadline column", () => {
  test("open / closed / sides", () => {
    expect(matches("open", mine("payer", { status: "Funded" }), clock)).toBe(true);
    expect(matches("closed", mine("payer", { status: "Split" }), clock)).toBe(true);
    expect(matches("paying", mine("recipient"), clock)).toBe(false);
    expect(matches("receiving", mine("recipient"), clock)).toBe(true);
    expect(matches("need", mine("payer", { status: "Funded" }), clock)).toBe(true);
  });
  test("when", () => {
    expect(whenText(mine("arbiter", { status: "Disputed", arbiter: ARBITER }))).toBe("Decide now");
    expect(whenText(mine("payer", { status: "Funded" }, true))).toBe("Passed");
    expect(whenText(mine("payer", { status: "Funded", deadline: 1_793_000_000 }))).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    expect(whenText(mine("payer", { status: "Released", closedAt: 1_793_000_000 }))).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });
});

describe("activity", () => {
  test("signs follow money to or from this wallet", () => {
    expect(activityOf(mine("recipient", { status: "Released", closedAt: 9 }))).toMatchObject({ what: "Paid to you", sign: "+", amount: 2_500_000_000n });
    expect(activityOf(mine("payer", { status: "Released", closedAt: 9, closedBy: PAYER }))).toMatchObject({ what: "You released", sign: "-" });
    expect(activityOf(mine("payer", { status: "Refunded", closedAt: 9, closedBy: RECIPIENT }))).toMatchObject({ what: "Refunded to you", sign: "+" });
    expect(activityOf(mine("payer", { status: "Refunded", closedAt: 9, closedBy: PAYER }))).toMatchObject({ what: "You reclaimed it", sign: "+" });
    expect(activityOf(mine("recipient", { status: "Refunded", closedAt: 9, closedBy: RECIPIENT }))).toMatchObject({ what: "You refunded it", sign: "" });
    expect(activityOf(mine("payer", { status: "Funded" }))).toMatchObject({ what: "You locked it", sign: "-" });
    expect(activityOf(mine("recipient", { status: "Funded" }))).toMatchObject({ what: "Locked for you", sign: "" });
  });
  test("a split shows each side's own share", () => {
    const split = { status: "Split" as const, arbiter: ARBITER, closedBy: ARBITER, closedAt: 9, paidToRecipient: 6_000_000n, paidToPayer: 4_000_000n };
    expect(activityOf(mine("payer", split))).toMatchObject({ sign: "+", amount: 4_000_000n });
    expect(activityOf(mine("recipient", split))).toMatchObject({ sign: "+", amount: 6_000_000n });
    expect(activityOf(mine("arbiter", split))).toMatchObject({ sign: "", what: "You split it" });
  });
  test("awaiting deposit has no movement; newest first, capped", () => {
    expect(activityOf(mine("payer", { status: "Created" }))).toBeNull();
    const list = [1, 2, 3, 4, 5, 6].map((i) => mine("recipient", { id: BigInt(i), status: "Released", closedAt: i * 10 }));
    expect(recentActivity(list).map((a) => a.id)).toEqual(["6", "5", "4", "3", "2"]);
  });
});
