import { describe, expect, test } from "vitest";
import { ARBITER, PAYER, RECIPIENT, view } from "@/tests/fixtures";
import { APP_STATUS_LABEL, STATUS_LABEL, closedByRole, moneyCard, showsDeadlinePassed, statusSentence } from "./status";
import { STATUSES } from "./types";

describe("labels", () => {
  test("exact website chip labels for all 7 statuses", () => {
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
  test("app chips say Locked for Funded and keep 'not funded' (INTEGRATION §3)", () => {
    expect(APP_STATUS_LABEL.Funded).toBe("Locked");
    expect(APP_STATUS_LABEL.Created).toBe("Awaiting deposit — not funded");
    for (const s of STATUSES) if (s !== "Funded") expect(APP_STATUS_LABEL[s]).toBe(STATUS_LABEL[s]);
  });
  test("the deadline modifier shows only on Created and Funded", () => {
    for (const s of STATUSES) expect(showsDeadlinePassed(view({ status: s }, true))).toBe(s === "Created" || s === "Funded");
    expect(showsDeadlinePassed(view({ status: "Funded" }, false))).toBe(false);
  });
});

describe("where the money is", () => {
  test.each([
    ["Created", "Awaiting deposit", "awaiting", 0n, false, false],
    ["Funded", "In escrow", "lime", 2_500_000_000n, false, false],
    ["Disputed", "In dispute", "violet", 2_500_000_000n, false, false],
    ["Released", "Released", "ink", 2_500_000_000n, false, true],
    ["Refunded", "Refunded", "line", 2_500_000_000n, true, false],
    ["Split", "Split", "split", 2_500_000_000n, true, true],
    ["Cancelled", "Cancelled", "muted", 0n, false, false],
  ] as const)("%s", (status, label, tone, shown, payerLit, recipientLit) => {
    const m = moneyCard(view({ status }).escrow);
    expect(m).toMatchObject({ label, tone, shown, payerLit, recipientLit });
  });
  test("Created never shows the amount as locked", () => {
    const v = view({ status: "Created", fundedAt: 0 });
    expect(moneyCard(v.escrow).shown).toBe(0n);
    expect(moneyCard(v.escrow).unit).toMatch(/nothing locked yet/);
    expect(statusSentence(v)).toBe("Nothing locked yet. Waiting for the payer's deposit.");
  });
});

describe("one-line stories", () => {
  test("Funded, before and after the deadline", () => {
    expect(statusSentence(view({ status: "Funded" }))).toBe("Locked in the contract until released or refunded.");
    expect(statusSentence(view({ status: "Funded" }, true))).toMatch(/The deadline has passed, so the payer can also take it back\.$/);
  });
  test("Disputed", () => {
    expect(statusSentence(view({ status: "Disputed", arbiter: ARBITER }))).toBe("In dispute. The arbiter decides the split.");
  });
  test("Released, by the payer or the arbiter", () => {
    expect(statusSentence(view({ status: "Released", closedBy: PAYER }))).toBe("Released to the recipient. Closed.");
    expect(statusSentence(view({ status: "Released", arbiter: ARBITER, closedBy: ARBITER }))).toBe("Released to the recipient by the arbiter. Closed.");
  });
  test("Refunded wording follows closed_by", () => {
    expect(statusSentence(view({ status: "Refunded", closedBy: RECIPIENT }))).toMatch(/The recipient refunded it\./);
    expect(statusSentence(view({ status: "Refunded", closedBy: PAYER }))).toMatch(/The payer reclaimed it after the deadline\./);
    expect(statusSentence(view({ status: "Refunded", arbiter: ARBITER, closedBy: ARBITER }))).toMatch(/The arbiter decided it\./);
    expect(statusSentence(view({ status: "Refunded", closedBy: null }))).toBe("Refunded to the payer. Closed.");
    expect(closedByRole(view({ status: "Refunded", closedBy: null }).escrow)).toBeNull();
  });
  test("Split names both amounts from paid_to_*", () => {
    expect(statusSentence(view({ status: "Split", arbiter: ARBITER, closedBy: ARBITER, paidToRecipient: 6_000_000n, paidToPayer: 4_000_000n }))).toBe(
      "Split 0.60 to the recipient, 0.40 to the payer. Closed.",
    );
  });
  test("Cancelled", () => {
    expect(statusSentence(view({ status: "Cancelled" }))).toBe("Cancelled before any deposit. No money ever moved.");
  });
});
