"use client";
import { useMemo, useState } from "react";
import { readHidden } from "../sisonke/hidden";
import { collect, type Clock } from "../sisonke/overview";
import { useInfo, useParty } from "./queries";
import { useLedgerClock } from "./useLedgerClock";

/**
 * Every escrow the wallet pays, receives or arbitrates (three indexed reads,
 * newest first), split into visible rows and the collapsed hidden/spam ones.
 */
export function useMyEscrows(address: string | null) {
  const [pages, setPages] = useState(1);
  const payer = useParty(address, "Payer", pages);
  const recipient = useParty(address, "Recipient", pages);
  const arbiter = useParty(address, "Arbiter", pages);
  const info = useInfo();
  const { ledgerNow } = useLedgerClock(5000);

  const hidden = useMemo(() => (address ? readHidden(address) : new Set<string>()), [address]);
  const list = useMemo(() => {
    const views = [...(payer.data?.views ?? []), ...(recipient.data?.views ?? []), ...(arbiter.data?.views ?? [])];
    return address ? collect(address, views, hidden) : { visible: [], collapsed: [], spam: 0 };
  }, [address, payer.data, recipient.data, arbiter.data, hidden]);

  const queries = [payer, recipient, arbiter];
  const failed = queries.find((q) => q.isError && !q.data);
  const clock: Clock = { ledgerNow, paused: !!info.data?.info?.paused };
  return {
    ...list,
    hidden,
    clock,
    token: info.data?.info?.token ?? null,
    loaded: queries.every((q) => !!q.data),
    error: failed?.error ?? null,
    refetch: () => queries.forEach((q) => void q.refetch()),
    hasOlder: queries.some((q) => q.data?.hasOlder),
    fetching: queries.some((q) => q.isFetching),
    older: () => setPages((n) => n + 1),
  };
}
