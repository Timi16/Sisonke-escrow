"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DASHBOARD_WINDOW, config } from "../config";
import { getEscrowHistory } from "../sisonke/events";
import { codeExists, getEscrow, getEscrows, getInfo, newestIds, partyCount, sacBalance } from "../sisonke/reads";
import type { ContractInfo, Escrow, EscrowView, PartyRole } from "../sisonke/types";
import { getReadiness } from "../stellar/horizon";
import { liveChecks, staticChecks, type Misconfigured } from "../stellar/network";
import { server, withRetry } from "../stellar/rpc";

export const keys = {
  info: ["info"] as const,
  ledger: ["ledger"] as const,
  escrow: (id: string) => ["escrow", id] as const,
  history: (id: string) => ["history", id] as const,
  party: (address: string, role: PartyRole, pages = 1) => ["party", address, role, pages] as const,
  arbiterStats: (arbiter: string) => ["arbiterStats", arbiter] as const,
  readiness: (address: string) => ["readiness", address] as const,
  trust: (address: string) => ["trust", address] as const,
  code: (hash: string) => ["code", hash] as const,
  sacBalance: ["sacBalance"] as const,
};

export interface InfoResult {
  info: ContractInfo | null;
  misconfigured: Misconfigured | null;
}

/** info() plus the startup checks. A failed check hides every escrow. */
export async function loadInfo(): Promise<InfoResult> {
  const local = staticChecks();
  if (local) return { info: null, misconfigured: local };
  const [network, info] = await Promise.all([withRetry(() => server.getNetwork()), getInfo()]);
  return { info, misconfigured: liveChecks(network.passphrase, info) };
}

export function useInfo() {
  return useQuery({ queryKey: keys.info, queryFn: loadInfo, refetchInterval: 30_000, staleTime: 20_000 });
}

/** One escrow, live: every 10 s. `null` data means it doesn't exist. */
export function useEscrow(id: string | null) {
  return useQuery({
    queryKey: keys.escrow(id ?? ""),
    queryFn: () => getEscrow(BigInt(id!)),
    enabled: id !== null,
    refetchInterval: 10_000,
  });
}

export function useHistory(escrow: Escrow | null | undefined) {
  return useQuery({
    queryKey: keys.history(escrow ? escrow.id.toString() : ""),
    queryFn: () => getEscrowHistory(escrow!),
    enabled: !!escrow,
    refetchInterval: 15_000,
  });
}

export interface PartyEscrows {
  count: number;
  views: EscrowView[];
  /** More ids exist beyond the ones read. */
  hasOlder: boolean;
}

/** Count, newest pages, then get_escrows in batches of 20, newest first. */
export function useParty(address: string | null, role: PartyRole, windows = 1, enabled = true) {
  return useQuery({
    queryKey: keys.party(address ?? "", role, windows),
    enabled: !!address && enabled,
    refetchInterval: 20_000,
    // "Show older escrows" changes the key: keep the rows on screen meanwhile.
    // Only for the same wallet and role, never another wallet's rows.
    placeholderData: (prev, prevQuery) =>
      prevQuery && prevQuery.queryKey[1] === address && prevQuery.queryKey[2] === role ? keepPreviousData(prev) : undefined,
    queryFn: async (): Promise<PartyEscrows> => {
      const count = await partyCount(address!, role);
      if (count === 0) return { count, views: [], hasOlder: false };
      const ids = await newestIds(address!, role, count, DASHBOARD_WINDOW * windows);
      const views = ids.length ? await getEscrows(ids) : [];
      views.sort((a, b) => (a.escrow.id < b.escrow.id ? 1 : a.escrow.id > b.escrow.id ? -1 : 0));
      return { count, views, hasOlder: count > DASHBOARD_WINDOW * windows };
    },
  });
}

export interface ArbiterStats {
  count: number;
  decided: number;
  forRecipient: number;
  forPayer: number;
  split: number;
}

/** The arbiter's track record (WEB_PLAN §6.6), from its newest ≤ 40 escrows. */
export function useArbiterStats(arbiter: string | null) {
  return useQuery({
    queryKey: keys.arbiterStats(arbiter ?? ""),
    enabled: !!arbiter,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ArbiterStats> => {
      const count = await partyCount(arbiter!, "Arbiter");
      const ids = count ? await newestIds(arbiter!, "Arbiter", count, 40) : [];
      const views = ids.length ? await getEscrows(ids) : [];
      const decided = views.filter((v) => v.escrow.closedBy === arbiter);
      return {
        count,
        decided: decided.length,
        forRecipient: decided.filter((v) => v.escrow.status === "Released").length,
        forPayer: decided.filter((v) => v.escrow.status === "Refunded").length,
        split: decided.filter((v) => v.escrow.status === "Split").length,
      };
    },
  });
}

export function useReadiness(address: string | null, fast = false) {
  return useQuery({
    queryKey: keys.readiness(address ?? ""),
    queryFn: () => getReadiness(address!),
    enabled: !!address,
    refetchInterval: fast ? 5_000 : 15_000,
  });
}

/** A counterparty's USDC trustline, for warnings before release/refund/resolve. */
export function useTrust(address: string | null) {
  return useQuery({
    queryKey: keys.trust(address ?? ""),
    queryFn: () => getReadiness(address!),
    enabled: !!address,
    refetchInterval: 60_000,
  });
}

/** Whether a proposed upgrade's wasm is published. */
export function useCodeExists(hash: string | null) {
  return useQuery({
    queryKey: keys.code(hash ?? ""),
    queryFn: () => codeExists(hash!),
    enabled: !!hash,
    refetchInterval: 60_000,
  });
}

/** The contract's USDC balance (rules "About"). */
export function useContractBalance() {
  return useQuery({ queryKey: keys.sacBalance, queryFn: () => sacBalance(config.contractId), refetchInterval: 60_000 });
}
