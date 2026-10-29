/** Deadlines in ledger time (seconds). WEB_PLAN §8.3, §6.2. */
import { DISPUTE_CUTOFF, MAX_DEADLINE_MARGIN, MAX_DURATION, MIN_DEADLINE_LEAD } from "../config";

export const PRESETS = [
  { id: "3d", label: "3 days", days: 3 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "14d", label: "14 days", days: 14 },
  { id: "30d", label: "30 days", days: 30 },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"] | "custom";
export const DEFAULT_PRESET: PresetId = "7d";

export function presetDeadline(ledgerNow: number, days: number): number {
  return Math.floor(ledgerNow) + days * 86_400;
}

export type DeadlineCheck = { ok: true; deadline: number } | { ok: false; error: string };

/** A `datetime-local` value (the user's local time) → unix seconds, within bounds. */
export function customDeadline(local: string, ledgerNow: number): DeadlineCheck {
  if (!local) return { ok: false, error: "Pick a date and time." };
  const ms = Date.parse(local);
  if (Number.isNaN(ms)) return { ok: false, error: "Pick a date and time." };
  return checkDeadline(Math.floor(ms / 1000), ledgerNow);
}

export function checkDeadline(deadline: number, ledgerNow: number): DeadlineCheck {
  if (deadline < ledgerNow + MIN_DEADLINE_LEAD) return { ok: false, error: "Pick a time at least 2 minutes from now." };
  if (deadline > ledgerNow + MAX_DURATION - MAX_DEADLINE_MARGIN) return { ok: false, error: "Pick a deadline within 365 days." };
  return { ok: true, deadline };
}

/** Disputes are offered only until 10 minutes before the deadline. */
export function disputeWindowOpen(deadline: number, ledgerNow: number | null): boolean {
  if (ledgerNow === null) return false;
  return ledgerNow < deadline - DISPUTE_CUTOFF;
}
