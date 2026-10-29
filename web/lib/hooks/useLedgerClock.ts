"use client";
import { useQuery } from "@tanstack/react-query";
import { server, withRetry } from "../stellar/rpc";
import { useNow } from "./useNow";

export interface LedgerReading {
  sequence: number;
  /** Close time of the latest ledger, unix seconds. */
  closeTime: number;
  /** Date.now() when it was read. */
  fetchedAt: number;
}

export async function readLedger(): Promise<LedgerReading> {
  const latest = await withRetry(() => server.getLatestLedger());
  const closeTime = Number((latest as { closeTime?: string | number }).closeTime ?? NaN);
  return {
    sequence: latest.sequence,
    closeTime: Number.isFinite(closeTime) ? closeTime : Math.floor(Date.now() / 1000),
    fetchedAt: Date.now(),
  };
}

/** Ledger time estimate: the last close time plus wall time since it was read. */
export function ledgerNowFrom(reading: LedgerReading | undefined, nowMs: number | null): number | null {
  if (!reading || nowMs === null) return null;
  return reading.closeTime + (nowMs - reading.fetchedAt) / 1000;
}

/**
 * Ledger time, ticking every `intervalMs`. Null until both the first ledger
 * read and the client clock are available (never during prerender).
 */
export function useLedgerClock(intervalMs = 1000) {
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: readLedger, refetchInterval: 15_000, staleTime: 10_000 });
  const now = useNow(intervalMs);
  return { ledgerNow: ledgerNowFrom(ledger.data, now), reading: ledger.data, isError: ledger.isError };
}
