/** Who the connected wallet is on one escrow (WEB_PLAN §6.1). The admin has no role. */
import type { Escrow, Role } from "./types";

export function roleOf(e: Pick<Escrow, "payer" | "recipient" | "arbiter">, address: string | null): Role {
  if (!address) return "guest";
  if (address === e.payer) return "payer";
  if (address === e.recipient) return "recipient";
  if (e.arbiter && address === e.arbiter) return "arbiter";
  return "stranger";
}

/** "payer" → "Payer". */
export const roleLabel = (r: "payer" | "recipient" | "arbiter") => r.charAt(0).toUpperCase() + r.slice(1);
