import { describe, expect, test } from "vitest";
import { ARBITER, PAYER, RECIPIENT, view } from "@/tests/fixtures";
import { STATUS_LABEL, closedByRole, moneyPosition, progressSteps, rowHint, showsDeadlinePassed, statusSentence } from "./status";
import { STATUSES } from "./types";

describe("labels", () => {
  test("exact chip labels for all 7 statuses", () => {
    expect(STATUS_LABEL).toEqual({
      Created: "Awaiting deposit — not funded",
      Funded: "Funded",
      Disputed: "In dispute",
      Released: "Released",
      Refunded: "Refunded",
      Split: "Split",
      Cancelled: "Cancelled",
    });
  });
  test("the deadline modifier shows only on Created and Funded", () => {
    for (const s of STATUSES) expect(showsDeadlinePassed(view({ status: s }, true))).toBe(s === "Created" || s === "Funded");
    expect(showsDeadlinePassed(view({ status: "Funded" }, false))).toBe(false);
  });
});

describe("money position", () => {
  test.each([
    ["Created", "16.66%", 0n, "Nothing locked yet"],
    ["Funded", "50%", 2_500_000_000n, "Locked until released or refunded"],
    ["Disputed", "50%", 2_500_000_000n, "In dispute"],
    ["Released", "83.33%", 0n, "Paid out to the recipient"],
    ["Refunded", "16.66%", 0n, "Returned to the payer"],
    ["Split", "50%", 0n, "Split by the arbiter"],
    ["Cancelled", "16.66%", 0n, "Nothing ever locked"],
  ] as const)("%s", (status, coin, holds, caption) => {
    const m = moneyPosition(view({ status }).escrow);
    expect(m.coinLeft).toBe(coin);
    expect(m.contractHolds).toBe(holds);
    expect(m.caption).toBe(caption);
    expect(m.coinFaded).toBe(status === "Split");
  });
  test("highlighted cells", () => {
    expect(moneyPosition(view({ status: "Funded" }).escrow).highlight).toEqual({ contract: "lime" });
    expect(moneyPosition(view({ status: "Disputed" }).escrow).highlight).toEqual({ contract: "lilac" });
    expect(moneyPosition(view({ status: "Split" }).escrow).highlight).toEqual({ payer: "ground", recipient: "ground" });
    expect(moneyPosition(view({ status: "Cancelled" }).escrow).highlight).toEqual({});
  });
  test("Created never shows the amount as locked", () => {
    const v = view({ status: "Created", fundedAt: 0 });
    expect(moneyPosition(v.escrow).contractHolds).toBe(0n);
    expect(statusSentence(v)).toBe("Waiting for the payer to deposit 250.00 USDC. Nothing is locked yet.");
    expect(statusSentence(v)).not.toMatch(/is locked in/);
  });
});

describe("sentences", () => {
  test("Created, from the payer's side", () => {
    expect(statusSentence(view({ status: "Created" }), "payer")).toBe("Waiting for you to deposit 250.00 USDC. Nothing is locked yet.");
  });
  test("Funded with and without arbiter, and past the deadline", () => {
    expect(statusSentence(view({ status: "Funded" }))).toBe(
      "250.00 USDC is locked in the contract. It moves only when the payer releases it or the recipient refunds it.",
    );
    expect(statusSentence(view({ status: "Funded", arbiter: ARBITER }))).toMatch(/refunds it, or the arbiter decides a dispute\.$/);
    expect(statusSentence(view({ status: "Funded" }, true))).toMatch(/The deadline has passed, so the payer can also take it back\.$/);
  });
  test("Disputed", () => {
    expect(statusSentence(view({ status: "Disputed", arbiter: ARBITER }))).toMatch(/^250\.00 USDC is locked and in dispute\./);
  });
  test("Released, by the payer or the arbiter", () => {
    expect(statusSentence(view({ status: "Released", closedBy: PAYER }))).toBe("250.00 USDC was paid to the recipient. This escrow is closed for good.");
    expect(statusSentence(view({ status: "Released", arbiter: ARBITER, closedBy: ARBITER }))).toBe(
      "250.00 USDC was paid to the recipient, by the arbiter's decision. This escrow is closed for good.",
    );
  });
  test("Refunded wording follows closed_by", () => {
    expect(statusSentence(view({ status: "Refunded", closedBy: RECIPIENT }))).toBe(
      "250.00 USDC went back to the payer. The recipient refunded it. This escrow is closed for good.",
    );
    expect(statusSentence(view({ status: "Refunded", closedBy: PAYER }))).toMatch(/The payer reclaimed it after the deadline\./);
    expect(statusSentence(view({ status: "Refunded", arbiter: ARBITER, closedBy: ARBITER }))).toMatch(/The arbiter decided it\./);
    expect(closedByRole(view({ status: "Refunded", closedBy: null }).escrow)).toBeNull();
  });
  test("Split names both amounts from paid_to_*", () => {
    expect(statusSentence(view({ status: "Split", arbiter: ARBITER, closedBy: ARBITER, paidToRecipient: 6_000_000n, paidToPayer: 4_000_000n }))).toBe(
      "The arbiter divided it: 0.60 USDC to the recipient, 0.40 USDC to the payer. Closed for good.",
    );
  });
  test("Cancelled", () => {
    expect(statusSentence(view({ status: "Cancelled" }))).toBe("The payer cancelled it before depositing. No money ever moved.");
  });
});

describe("progress steps", () => {
  test("Created → Funded → final", () => {
    expect(progressSteps("Created").map((s) => [s.label, s.state])).toEqual([
      ["Created", "current"],
      ["Funded", "todo"],
      ["Released or refunded", "todo"],
    ]);
    expect(progressSteps("Funded").map((s) => s.state)).toEqual(["done", "current", "todo"]);
    expect(progressSteps("Released").map((s) => [s.label, s.state])).toEqual([
      ["Created", "done"],
      ["Funded", "done"],
      ["Released", "current"],
    ]);
    expect(progressSteps("Split")[2].label).toBe("Split");
    expect(progressSteps("Refunded")[2].label).toBe("Refunded");
  });
  test("Disputed marks step 2 in violet", () => {
    const steps = progressSteps("Disputed");
    expect(steps[1]).toEqual({ label: "In dispute", state: "current", dispute: true });
  });
  test("Cancelled has two steps", () => {
    expect(progressSteps("Cancelled").map((s) => s.label)).toEqual(["Created", "Cancelled"]);
  });
});

describe("row hints", () => {
  test("paying tab", () => {
    expect(rowHint(view({ status: "Created" }), "paying")).toEqual({ text: "Deposit to lock it", needsYou: true });
    expect(rowHint(view({ status: "Created" }, true), "paying")).toEqual({ text: "Too late to deposit. Cancel it", needsYou: true });
    expect(rowHint(view({ status: "Funded" }), "paying").text).toBe("Release when the work is in");
    expect(rowHint(view({ status: "Funded" }, true), "paying").text).toBe("Deadline passed. Release or reclaim");
    expect(rowHint(view({ status: "Refunded", closedBy: RECIPIENT }), "paying").text).toBe("Came back to you");
    expect(rowHint(view({ status: "Refunded", closedBy: PAYER }), "paying").text).toBe("You took it back");
    expect(rowHint(view({ status: "Refunded", arbiter: ARBITER, closedBy: ARBITER }), "paying").text).toBe("The arbiter returned it");
    expect(rowHint(view({ status: "Released" }), "paying")).toEqual({ text: "Paid out", needsYou: false });
  });
  test("receiving tab", () => {
    expect(rowHint(view({ status: "Funded" }), "receiving")).toEqual({ text: "Locked. Safe to start work", needsYou: true });
    expect(rowHint(view({ status: "Funded" }, true), "receiving")).toEqual({ text: "Deadline passed. The payer can take it back", needsYou: false });
    expect(rowHint(view({ status: "Released" }), "receiving").text).toBe("You got paid");
    expect(rowHint(view({ status: "Refunded", closedBy: RECIPIENT }), "receiving").text).toBe("You sent it back");
    expect(rowHint(view({ status: "Refunded", closedBy: PAYER }), "receiving").text).toBe("The payer took it back");
  });
  test("arbiter tab", () => {
    expect(rowHint(view({ status: "Disputed", arbiter: ARBITER }), "arbiter")).toEqual({ text: "Your decision", needsYou: true });
    expect(rowHint(view({ status: "Funded", arbiter: ARBITER }), "arbiter").text).toBe("No dispute");
    expect(rowHint(view({ status: "Split", arbiter: ARBITER }), "arbiter").text).toBe("Closed");
  });
});
