import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { MAX_STROOPS, balanceStroops, formatUsdc, parseAmount, parseAmountOrZero, toDecimalString } from "./amount";

const ok = (text: string) => {
  const r = parseAmount(text);
  if (!r.ok) throw new Error(`expected ${text} to parse: ${r.error}`);
  return r.stroops;
};
const err = (text: string) => {
  const r = parseAmount(text);
  if (r.ok) throw new Error(`expected ${text} to fail`);
  return r.error;
};

describe("parseAmount", () => {
  test.each([
    ["250", 2_500_000_000n],
    ["250.5", 2_505_000_000n],
    [".5", 5_000_000n],
    ["12.", 120_000_000n],
    ["1,234.56", 12_345_600_000n],
    ["0.0000001", 1n],
    ["  7  ", 70_000_000n],
    ["1,000,000", 10_000_000_000_000n],
    ["922337203685.4775807", MAX_STROOPS],
  ])("%s → %s", (text, stroops) => {
    expect(ok(text)).toBe(stroops);
  });

  test.each([
    ["1,5", "Use a dot for decimals, like 1.50."],
    ["1.23456789", "USDC has at most 7 decimal places."],
    ["0", "Enter an amount above zero."],
    ["0.0000000", "Enter an amount above zero."],
    ["922337203685.4775808", "That's more than any wallet can hold."],
  ])("%s is refused with its message", (text, message) => {
    expect(err(text)).toBe(message);
  });

  test.each(["-1", "+1", "1e3", "1 000", "١٢", "abc", "", ".", "1..2", "1,23", "12,3456", ",5", "0x10", "Infinity", "NaN"])(
    "%s is refused",
    (text) => {
      expect(parseAmount(text).ok).toBe(false);
    },
  );

  test("never rounds: 8 decimals refuse rather than round", () => {
    expect(parseAmount("0.00000001").ok).toBe(false);
    expect(parseAmount("0.99999999").ok).toBe(false);
  });

  test("zero is allowed only through parseAmountOrZero", () => {
    expect(parseAmountOrZero("0")).toEqual({ ok: true, stroops: 0n });
    expect(parseAmountOrZero("0.00")).toEqual({ ok: true, stroops: 0n });
    expect(parseAmountOrZero("0.4")).toEqual({ ok: true, stroops: 4_000_000n });
  });

  test("Horizon balances", () => {
    expect(balanceStroops("1240.5000000")).toBe(12_405_000_000n);
    expect(balanceStroops("0.0000000")).toBe(0n);
    expect(balanceStroops(null)).toBe(0n);
    expect(balanceStroops("garbage")).toBe(0n);
  });
});

describe("formatUsdc", () => {
  test.each([
    [1n, "0.0000001"],
    [6_000_000n, "0.60"],
    [12_345_000_000_000n, "1,234,500.00"],
    [0n, "0.00"],
    [10_000_000n, "1.00"],
    [2_505_000_000n, "250.50"],
    [1_234_567n, "0.1234567"],
    [MAX_STROOPS, "922,337,203,685.4775807"],
    [-10_000_000n, "-1.00"],
  ])("%s → %s", (stroops, text) => {
    expect(formatUsdc(stroops)).toBe(text);
  });

  test("options", () => {
    expect(formatUsdc(10_000_000n, { min: 0 })).toBe("1");
    expect(formatUsdc(12_345_000_000_000n, { grouping: false })).toBe("1234500.00");
    expect(toDecimalString(12_345_000_000_000n)).toBe("1234500");
  });
});

describe("round trip", () => {
  // Fixed-seed LCG so failures reproduce.
  let seed = 0x5150_4e4bn;
  const next = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return seed;
  };
  test("1,000 pseudo-random amounts survive format → parse unchanged", () => {
    for (let i = 0; i < 1000; i++) {
      const stroops = (next() % MAX_STROOPS) + 1n;
      expect(ok(formatUsdc(stroops))).toBe(stroops);
      expect(ok(formatUsdc(stroops, { grouping: false }))).toBe(stroops);
      expect(ok(toDecimalString(stroops))).toBe(stroops);
    }
  });
});

test("no float code in the amount module", () => {
  const src = readFileSync(fileURLToPath(new URL("./amount.ts", import.meta.url)), "utf8");
  expect(src).not.toMatch(/parseFloat|Number\(|toFixed|Math\./);
});
