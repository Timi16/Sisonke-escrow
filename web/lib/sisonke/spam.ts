/**
 * Unsolicited-escrow filter for the receiving and arbiter tabs (INTEGRATION §7).
 * A view preference only: it never changes status, amounts or actions.
 */
import { SPAM_MIN_AMOUNT, SPAM_SHORT_LIFE } from "../config";
import { isFinal, type Escrow } from "./types";

export function likelySpam(e: Escrow, me: string, tab: "paying" | "receiving" | "arbiter"): boolean {
  if (tab === "paying") return false;
  const interacted = e.closedBy === me || e.disputedBy === me;
  if (interacted) return false;
  if (e.amount < SPAM_MIN_AMOUNT) return true;
  if (isFinal(e.status) && e.closedAt > 0 && e.closedAt - e.createdAt < SPAM_SHORT_LIFE) return true;
  if (e.status === "Refunded" && e.closedBy === e.payer) return true;
  return false;
}
