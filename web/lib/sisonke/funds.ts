/** Test funds: how much XLM a DEX swap may spend. Bigint stroops (7 decimals), no floats. */

const UNIT = 10_000_000n;
/** XLM left in the wallet after a swap: fees plus the account and trustline reserves. */
export const XLM_KEEP = 5n * UNIT;
/** A quote dearer than this per USDC is refused (Testnet prices are far below it). */
export const MAX_XLM_PER_USDC = 10n * UNIT;
export const SWAP_CHOICES = [50, 100, 500] as const;
export type SwapChoice = (typeof SWAP_CHOICES)[number];

export type SwapPlan =
  | { kind: "ok"; quote: bigint; sendMax: bigint }
  | { kind: "tooDear"; quote: bigint }
  | { kind: "short"; quote: bigint; spendable: bigint };

/**
 * `quote` XLM for `usdc` USDC with `xlm` in the wallet. Generous slippage
 * (up to 3× the quote), never above the per-USDC cap or what can be spent.
 */
export function planSwap(quote: bigint, usdc: number, xlm: bigint): SwapPlan {
  const cap = BigInt(usdc) * MAX_XLM_PER_USDC;
  if (quote <= 0n || quote > cap) return { kind: "tooDear", quote };
  const spendable = xlm > XLM_KEEP ? xlm - XLM_KEEP : 0n;
  if (quote > spendable) return { kind: "short", quote, spendable };
  let sendMax = quote * 3n;
  if (sendMax > cap) sendMax = cap;
  if (sendMax > spendable) sendMax = spendable;
  return { kind: "ok", quote, sendMax };
}

/** "100.0000000": a Horizon/Stellar amount string for a whole number of USDC. */
export const usdcAmount = (usdc: number) => `${usdc}.0000000`;
