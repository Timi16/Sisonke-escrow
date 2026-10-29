/**
 * USDC amounts as bigint stroops (7 decimals). No floats anywhere on money:
 * parsing and formatting are string and bigint operations only.
 */
import { USDC_DECIMALS } from "../config";

const UNIT = 10n ** BigInt(USDC_DECIMALS);
/** i64 max: the most a Stellar balance can hold. */
export const MAX_STROOPS = 9_223_372_036_854_775_807n;

export type ParsedAmount = { ok: true; stroops: bigint } | { ok: false; error: string };

const SHAPE = /^(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d*))?$/;

/**
 * "250" | "250.5" | ".5" | "1,234.56" → stroops. Commas only as thousands
 * separators; never rounds.
 */
export function parseAmount(text: string): ParsedAmount {
  const t = text.trim();
  if (!t) return { ok: false, error: "Enter an amount." };
  if (/^\d+,\d{1,2}$/.test(t) || /^\d+(?:\.\d{3})*,\d+$/.test(t)) {
    return { ok: false, error: "Use a dot for decimals, like 1.50." };
  }
  const match = SHAPE.exec(t);
  if (!match || !/\d/.test(t)) {
    return { ok: false, error: "Enter an amount in USDC, like 250 or 12.50." };
  }
  const [whole, frac = ""] = t.replace(/,/g, "").split(".");
  if (frac.length > USDC_DECIMALS) return { ok: false, error: "USDC has at most 7 decimal places." };
  const stroops = BigInt(whole || "0") * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
  if (stroops === 0n) return { ok: false, error: "Enter an amount above zero." };
  if (stroops > MAX_STROOPS) return { ok: false, error: "That's more than any wallet can hold." };
  return { ok: true, stroops };
}

/** Like parseAmount, but zero is allowed (resolve splits, balances). */
export function parseAmountOrZero(text: string): ParsedAmount {
  const t = text.trim();
  if (/^0*(?:\.0*)?$/.test(t) && /\d/.test(t)) return { ok: true, stroops: 0n };
  return parseAmount(text);
}

/** Horizon balance strings ("1240.5000000") → stroops, or 0n if malformed. */
export function balanceStroops(balance: string | null | undefined): bigint {
  if (!balance) return 0n;
  const parsed = parseAmountOrZero(balance);
  return parsed.ok ? parsed.stroops : 0n;
}

function group(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * 1n → "0.0000001", 6_000_000n → "0.60", 12_345_000_000_000n → "1,234,500.00".
 * Keeps every significant decimal (up to 7), at least `min`. Never rounds.
 */
export function formatUsdc(stroops: bigint, { min = 2, grouping = true }: { min?: number; grouping?: boolean } = {}): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = (abs / UNIT).toString();
  let frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < min) frac = frac.padEnd(min, "0");
  return `${negative ? "-" : ""}${grouping ? group(whole) : whole}${frac ? `.${frac}` : ""}`;
}

/** Plain decimal string for inputs and Stellar operations: "12.5". */
export function toDecimalString(stroops: bigint): string {
  return formatUsdc(stroops, { min: 0, grouping: false });
}

/** Fee in XLM (stroops of XLM, 7 decimals) → "0.0123456". */
export function formatXlm(stroops: bigint): string {
  return formatUsdc(stroops, { min: 1 });
}
