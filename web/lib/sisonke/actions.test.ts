import { describe, expect, test } from "vitest";
import { actionsFor, type ActionId, type Ctx } from "./actions";
import { STATUSES, type Role, type Status } from "./types";

const ROLES: Role[] = ["guest", "payer", "recipient", "arbiter", "stranger"];
const ACTIONS: ActionId[] = ["fund", "cancel", "release", "refund", "reclaim", "dispute", "resolve"];
const BOOLS = [false, true];

/**
 * The ✔ cells of docs/CONTRACT.md "Who may do what, in which status", written
 * out independently of actions.ts: which signer may call `fn` and succeed.
 */
function contractAllows(fn: ActionId, c: Ctx): boolean {
  const { status, role, deadlinePassed: dp, hasArbiter, paused } = c;
  switch (fn) {
    case "fund":
      return role === "payer" && status === "Created" && !dp && !paused;
    case "cancel":
      return role === "payer" && status === "Created";
    case "release":
      return role === "payer" && (status === "Funded" || status === "Disputed");
    case "refund":
      return role === "recipient" && (status === "Funded" || status === "Disputed");
    case "reclaim":
      return role === "payer" && status === "Funded" && dp;
    case "dispute":
      return (role === "payer" || role === "recipient") && status === "Funded" && !dp && hasArbiter;
    case "resolve":
      return role === "arbiter" && status === "Disputed" && hasArbiter;
  }
}

/** The app offers what the contract allows, minus disputes inside the 10-minute cutoff. */
const appAllows = (fn: ActionId, c: Ctx) => contractAllows(fn, c) && (fn !== "dispute" || c.disputeWindowOpen);

function* everyCtx(): Generator<Ctx> {
  for (const role of ROLES)
    for (const status of STATUSES)
      for (const deadlinePassed of BOOLS)
        for (const hasArbiter of BOOLS)
          for (const disputeWindowOpen of BOOLS)
            for (const paused of BOOLS) yield { role, status, deadlinePassed, hasArbiter, disputeWindowOpen, paused, deadlineText: "7 Nov 2026" };
}

const all = [...everyCtx()];
const PRIMARY: ActionId[] = ["fund", "release", "refund", "reclaim", "resolve"];

describe("actionsFor over the full product", () => {
  test("covers 5 roles × 7 statuses × 2⁴ flags", () => {
    expect(all.length).toBe(5 * 7 * 16);
  });

  test.each(all.map((c) => [`${c.role} ${c.status} dp=${c.deadlinePassed} arb=${c.hasArbiter} win=${c.disputeWindowOpen} paused=${c.paused}`, c] as const))(
    "%s",
    (_name, c) => {
      const { allowed, primary, blocked } = actionsFor(c);
      const expected = ACTIONS.filter((fn) => appAllows(fn, c));
      expect([...allowed].sort()).toEqual([...expected].sort());
      // Primary actions come first and are exactly the lime ones.
      expect(primary).toEqual(allowed.filter((a) => PRIMARY.includes(a)));
      expect(allowed.slice(0, primary.length)).toEqual(primary);
      // Nothing is both allowed and blocked; every blocked row has a reason.
      for (const b of blocked) {
        expect(allowed).not.toContain(b.id);
        expect(b.why.trim().length).toBeGreaterThan(0);
      }
      if (c.role !== "guest") {
        const candidates: ActionId[] = ["fund", "release", "refund", "reclaim"];
        if (c.hasArbiter) candidates.push("dispute", "resolve");
        if (c.status === "Created") candidates.push("cancel");
        expect(blocked.map((b) => b.id).sort()).toEqual(candidates.filter((x) => !allowed.includes(x)).sort());
      }
    },
  );
});

describe("invariants", () => {
  test("guests and strangers never get an action; guests get no blocked list", () => {
    for (const c of all.filter((x) => x.role === "guest" || x.role === "stranger")) {
      expect(actionsFor(c).allowed).toEqual([]);
      if (c.role === "guest") expect(actionsFor(c).blocked).toEqual([]);
    }
  });
  test("the arbiter only ever resolves, and only while Disputed", () => {
    for (const c of all.filter((x) => x.role === "arbiter")) {
      const { allowed } = actionsFor(c);
      expect(allowed.every((a) => a === "resolve")).toBe(true);
      if (allowed.length) expect(c.status).toBe("Disputed");
    }
  });
  test("nobody reclaims while Disputed", () => {
    for (const c of all.filter((x) => x.status === "Disputed")) expect(actionsFor(c).allowed).not.toContain("reclaim");
  });
  test("final statuses allow nothing", () => {
    for (const c of all.filter((x) => ["Released", "Refunded", "Split", "Cancelled"].includes(x.status as Status))) {
      expect(actionsFor(c).allowed).toEqual([]);
      for (const b of actionsFor(c).blocked) expect(b.why).toBe("This escrow is closed.");
    }
  });
  test("no dispute once the window has closed or without an arbiter", () => {
    for (const c of all.filter((x) => !x.disputeWindowOpen || !x.hasArbiter || x.deadlinePassed)) {
      expect(actionsFor(c).allowed).not.toContain("dispute");
    }
  });
});

describe("blocked reasons", () => {
  const base: Ctx = { role: "payer", status: "Funded", deadlinePassed: false, hasArbiter: true, disputeWindowOpen: true, paused: false, deadlineText: "7 Nov 2026, 14:00" };
  const why = (c: Partial<Ctx>, id: ActionId) => actionsFor({ ...base, ...c }).blocked.find((b) => b.id === id)?.why;

  test("wrong signer", () => {
    expect(why({ role: "stranger" }, "release")).toBe("You're not part of this escrow.");
    expect(why({ role: "recipient" }, "release")).toBe("Only the payer can do this.");
    expect(why({ role: "payer" }, "refund")).toBe("Only the recipient can do this.");
    expect(why({ role: "payer", status: "Disputed" }, "resolve")).toBe("Only the arbiter can do this.");
    expect(why({ role: "arbiter" }, "dispute")).toBe("Only the payer or the recipient can do this.");
  });
  test("status", () => {
    expect(why({}, "fund")).toBe("Already deposited.");
    expect(why({ status: "Created" }, "release")).toBe("Deposit first. Nothing is locked yet.");
    expect(why({ status: "Disputed" }, "reclaim")).toBe("A dispute is open, so the arbiter decides.");
    expect(why({ status: "Created" }, "dispute")).toBe("Nothing is locked yet.");
    expect(why({ status: "Disputed" }, "dispute")).toBe("A dispute is already open.");
    expect(why({ role: "arbiter" }, "resolve")).toBe("Only after someone opens a dispute.");
  });
  test("time and pause", () => {
    expect(why({ status: "Created", deadlinePassed: true }, "fund")).toBe("The deadline has passed.");
    expect(why({}, "reclaim")).toBe("Opens on 7 Nov 2026, 14:00 if still locked.");
    expect(why({ disputeWindowOpen: false }, "dispute")).toBe("Disputes close 10 minutes before the deadline, so one can't land too late.");
    expect(why({ status: "Created", paused: true }, "fund")).toBe("Deposits are paused right now.");
  });
  test("final status wins over everything", () => {
    expect(why({ status: "Released", role: "stranger" }, "release")).toBe("This escrow is closed.");
  });
});
