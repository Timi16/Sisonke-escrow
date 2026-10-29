/** Contract-level notices: the upgrade banner state and "what you can do alone" (WEB_PLAN §6.7). */
import type { ContractInfo, Role, Status } from "./types";

export type UpgradeState = "none" | "beforeEta" | "live" | "expired";

/** eta ≤ now ≤ expires_at is "live"; after expires_at it can't run. */
export function upgradeNotice(info: Pick<ContractInfo, "pendingUpgrade"> | null | undefined, ledgerNow: number | null): UpgradeState {
  const p = info?.pendingUpgrade;
  if (!p) return "none";
  if (ledgerNow === null) return "beforeEta";
  if (ledgerNow < p.eta) return "beforeEta";
  if (ledgerNow <= p.expiresAt) return "live";
  return "expired";
}

/** What the viewer can do on their own, right now, before an upgrade lands. */
export function aloneNow(role: Role, status: Status, deadlinePassed: boolean, deadlineText: string): string | null {
  if (role === "payer") {
    if (status === "Created") return "Nothing is locked. You can cancel.";
    if (status === "Funded") {
      return deadlinePassed
        ? "Reclaim it."
        : `Release to the recipient. To get your money back before ${deadlineText}, ask the recipient to refund.`;
    }
    if (status === "Disputed") return "Release to the recipient, or ask the arbiter to decide.";
  }
  if (role === "recipient" && (status === "Funded" || status === "Disputed")) return "Refund the payer.";
  if (role === "arbiter" && status === "Disputed") return "Decide the dispute.";
  return null;
}
