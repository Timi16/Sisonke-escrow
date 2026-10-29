import { describe, expect, test } from "vitest";
import { toLocalInput } from "../format";
import { DEFAULT_PRESET, PRESETS, checkDeadline, customDeadline, disputeWindowOpen, presetDeadline } from "./deadline";

const NOW = 1_800_000_000.75;

describe("presets", () => {
  test("whole days from floor(ledgerNow)", () => {
    expect(PRESETS.map((p) => p.days)).toEqual([3, 7, 14, 30]);
    expect(DEFAULT_PRESET).toBe("7d");
    expect(presetDeadline(NOW, 7)).toBe(1_800_000_000 + 7 * 86_400);
    for (const p of PRESETS) expect(checkDeadline(presetDeadline(NOW, p.days), NOW).ok).toBe(true);
  });
});

describe("custom deadlines", () => {
  test("bounds: at least 2 minutes ahead, within 365 days minus a margin", () => {
    const now = 1_800_000_000;
    expect(checkDeadline(now + 120, now)).toEqual({ ok: true, deadline: now + 120 });
    expect(checkDeadline(now + 119, now)).toEqual({ ok: false, error: "Pick a time at least 2 minutes from now." });
    expect(checkDeadline(now - 10, now).ok).toBe(false);
    expect(checkDeadline(now + 365 * 86_400 - 300, now).ok).toBe(true);
    expect(checkDeadline(now + 365 * 86_400 - 299, now)).toEqual({ ok: false, error: "Pick a deadline within 365 days." });
  });
  test("parses a datetime-local value in local time", () => {
    const now = 1_800_000_000;
    const target = now + 3 * 86_400 + 60;
    const local = toLocalInput(target);
    const r = customDeadline(local, now);
    expect(r.ok).toBe(true);
    // datetime-local has minute precision.
    if (r.ok) expect(Math.abs(r.deadline - target)).toBeLessThan(60);
    expect(customDeadline("", now)).toEqual({ ok: false, error: "Pick a date and time." });
    expect(customDeadline("not a date", now)).toEqual({ ok: false, error: "Pick a date and time." });
  });
});

describe("dispute window", () => {
  const deadline = 1_800_000_000;
  test("open until 10 minutes before the deadline", () => {
    expect(disputeWindowOpen(deadline, deadline - 601)).toBe(true);
    expect(disputeWindowOpen(deadline, deadline - 600)).toBe(false);
    expect(disputeWindowOpen(deadline, deadline + 5)).toBe(false);
    expect(disputeWindowOpen(deadline, null)).toBe(false);
  });
});
