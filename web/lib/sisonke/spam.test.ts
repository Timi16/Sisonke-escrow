import { describe, expect, test } from "vitest";
import { PAYER, RECIPIENT, escrow } from "@/tests/fixtures";
import { likelySpam } from "./spam";

const legit = { amount: 10_000_000n, status: "Funded" as const, createdAt: 1000, closedAt: 0 };

describe("likelySpam", () => {
  test("an ordinary funded escrow is shown", () => {
    expect(likelySpam(escrow(legit), RECIPIENT, "receiving")).toBe(false);
  });
  test("tiny amounts", () => {
    expect(likelySpam(escrow({ ...legit, amount: 99_999n }), RECIPIENT, "receiving")).toBe(true);
    expect(likelySpam(escrow({ ...legit, amount: 100_000n }), RECIPIENT, "receiving")).toBe(false);
    expect(likelySpam(escrow({ ...legit, amount: 1n }), RECIPIENT, "arbiter")).toBe(true);
  });
  test("short-lived final escrows", () => {
    expect(likelySpam(escrow({ ...legit, status: "Released", closedBy: PAYER, closedAt: 1000 + 3599 }), RECIPIENT, "receiving")).toBe(true);
    expect(likelySpam(escrow({ ...legit, status: "Released", closedBy: PAYER, closedAt: 1000 + 3600 }), RECIPIENT, "receiving")).toBe(false);
  });
  test("reclaimed by its own payer", () => {
    expect(likelySpam(escrow({ ...legit, status: "Refunded", closedBy: PAYER, closedAt: 1000 + 86_400 }), RECIPIENT, "receiving")).toBe(true);
  });
  test("signing on it (closing or disputing) overrides every rule", () => {
    expect(likelySpam(escrow({ ...legit, amount: 1n, status: "Refunded", closedBy: RECIPIENT, closedAt: 1001 }), RECIPIENT, "receiving")).toBe(false);
    expect(likelySpam(escrow({ ...legit, amount: 1n, status: "Disputed", disputedBy: RECIPIENT }), RECIPIENT, "receiving")).toBe(false);
  });
  test("the paying tab is never filtered", () => {
    expect(likelySpam(escrow({ ...legit, amount: 1n, status: "Refunded", closedBy: PAYER, closedAt: 1001 }), PAYER, "paying")).toBe(false);
  });
});
