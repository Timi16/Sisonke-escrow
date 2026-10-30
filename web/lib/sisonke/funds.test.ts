import { describe, expect, test } from "vitest";
import { MAX_XLM_PER_USDC, XLM_KEEP, planSwap, usdcAmount } from "./funds";

const XLM = 10_000_000n;

describe("planSwap", () => {
  test("3× slippage when the wallet can afford it", () => {
    expect(planSwap(380n * XLM, 100, 10_000n * XLM)).toEqual({ kind: "ok", quote: 380n * XLM, sendMax: 1_000n * XLM });
    expect(planSwap(19n * XLM, 50, 10_000n * XLM)).toEqual({ kind: "ok", quote: 19n * XLM, sendMax: 57n * XLM });
  });
  test("never above the per-USDC cap", () => {
    const r = planSwap(400n * XLM, 50, 10_000n * XLM);
    expect(r).toEqual({ kind: "ok", quote: 400n * XLM, sendMax: 50n * MAX_XLM_PER_USDC });
  });
  test("never spends the reserve", () => {
    const r = planSwap(100n * XLM, 50, 120n * XLM);
    expect(r).toEqual({ kind: "ok", quote: 100n * XLM, sendMax: 120n * XLM - XLM_KEEP });
  });
  test("too dear, zero, or more than the wallet can spend", () => {
    expect(planSwap(1_001n * XLM, 100, 10_000n * XLM).kind).toBe("tooDear");
    expect(planSwap(0n, 100, 10_000n * XLM).kind).toBe("tooDear");
    expect(planSwap(380n * XLM, 100, 300n * XLM)).toEqual({ kind: "short", quote: 380n * XLM, spendable: 295n * XLM });
    expect(planSwap(1n, 100, 2n * XLM)).toEqual({ kind: "short", quote: 1n, spendable: 0n });
  });
  test("amount strings", () => {
    expect(usdcAmount(500)).toBe("500.0000000");
  });
});
