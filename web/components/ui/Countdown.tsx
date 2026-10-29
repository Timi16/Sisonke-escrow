"use client";
import { countdown } from "@/lib/format";
import { useLedgerClock } from "@/lib/hooks/useLedgerClock";

/** "in 6d 23h", "in 3m 05s", "passed", from ledger time. Placeholder until the clock loads. */
export function Countdown({ to, passed }: { to: number; passed?: boolean }) {
  const { ledgerNow } = useLedgerClock(1000);
  if (passed) return <span>passed</span>;
  if (ledgerNow === null) return <span aria-hidden="true">…</span>;
  return <span className="tabular">{countdown(to - ledgerNow)}</span>;
}
