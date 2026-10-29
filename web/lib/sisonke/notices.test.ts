import { describe, expect, test } from "vitest";
import { aloneNow, upgradeNotice } from "./notices";
import type { Role, Status } from "./types";

const pending = { hash: "ab".repeat(32), eta: 1000, expiresAt: 2000 };

describe("upgradeNotice", () => {
  test("none without a proposal", () => {
    expect(upgradeNotice({ pendingUpgrade: null }, 500)).toBe("none");
    expect(upgradeNotice(null, 500)).toBe("none");
  });
  test("beforeEta / at eta / live / at expires_at / expired", () => {
    const info = { pendingUpgrade: pending };
    expect(upgradeNotice(info, 999)).toBe("beforeEta");
    expect(upgradeNotice(info, 1000)).toBe("live");
    expect(upgradeNotice(info, 1500)).toBe("live");
    expect(upgradeNotice(info, 2000)).toBe("live");
    expect(upgradeNotice(info, 2001)).toBe("expired");
  });
  test("an unknown clock errs on the side of warning", () => {
    expect(upgradeNotice({ pendingUpgrade: pending }, null)).toBe("beforeEta");
  });
});

describe("aloneNow", () => {
  const D = "7 Nov 2026, 14:00";
  test.each<[Role, Status, boolean, string | null]>([
    ["payer", "Created", false, "Nothing is locked. You can cancel."],
    ["payer", "Funded", false, `Release to the recipient. To get your money back before ${D}, ask the recipient to refund.`],
    ["payer", "Funded", true, "Reclaim it."],
    ["payer", "Disputed", false, "Release to the recipient, or ask the arbiter to decide."],
    ["recipient", "Funded", false, "Refund the payer."],
    ["recipient", "Funded", true, "Refund the payer."],
    ["recipient", "Disputed", false, "Refund the payer."],
    ["recipient", "Created", false, null],
    ["arbiter", "Disputed", false, "Decide the dispute."],
    ["arbiter", "Funded", false, null],
    ["stranger", "Funded", false, null],
    ["guest", "Disputed", false, null],
    ["payer", "Released", false, null],
    ["recipient", "Split", false, null],
  ])("%s %s past=%s", (role, status, past, text) => {
    expect(aloneNow(role, status, past, D)).toBe(text);
  });
});
