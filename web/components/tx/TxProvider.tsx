"use client";

/**
 * One write at a time. Holds the stage machine for the transaction in flight
 * so the card where it started can show it inline (WEB_PLAN §5.2), and
 * refreshes reads afterwards. The displayed status only changes through a
 * fresh chain read: nothing here is optimistic.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { xdr } from "@stellar/stellar-sdk";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { keys } from "@/lib/hooks/queries";
import { balanceStroops, formatUsdc } from "@/lib/sisonke/amount";
import type { WriteMethod } from "@/lib/sisonke/contract";
import { toSisonkeError, type FriendlyError } from "@/lib/sisonke/errors";
import { getEscrow } from "@/lib/sisonke/reads";
import type { Escrow, EscrowView } from "@/lib/sisonke/types";
import { getReadiness, type Readiness } from "@/lib/stellar/horizon";
import {
  addUsdcTrustline,
  invoke,
  PendingError,
  precheck,
  probe as probeCall,
  swapXlmForUsdc,
  type Run,
  type TxResult,
  type TxStage,
} from "@/lib/stellar/tx";
import type { Asset } from "@stellar/stellar-sdk";

export type Phase = TxStage | "done" | "error";

export interface TxState {
  seq: number;
  /** Where it started, e.g. "escrow:42", "create", "setup:trustline". */
  key: string;
  /** "Release to recipient" */
  label: string;
  method: WriteMethod | "changeTrust" | "pathPayment";
  phase: Phase;
  escrowId?: string;
  fee?: bigint;
  result?: TxResult;
  error?: FriendlyError;
}

type Job =
  | { kind: "invoke"; method: WriteMethod; args: xdr.ScVal[] }
  | { kind: "trustline" }
  | { kind: "swap"; destAmount: string; sendMax: string; path: Asset[] };

export interface RunOptions {
  key: string;
  label: string;
  job: Job;
  /** For error wording, pre-checks and cache refresh. */
  escrow?: Escrow | null;
  /** Stroops leaving the wallet (fund / create_and_fund). */
  amount?: bigint;
}

export type ProbeOutcome = { kind: "refused"; error: FriendlyError; enforced: boolean } | { kind: "would-accept" };

interface TxContext {
  busy: boolean;
  current: TxState | null;
  /** The state for one card, if the latest transaction started there. */
  at: (key: string) => TxState | null;
  run: (opts: RunOptions) => Promise<TxResult | null>;
  clear: (key?: string) => void;
  probe: (method: WriteMethod, args: xdr.ScVal[], escrow: Escrow | null) => Promise<ProbeOutcome>;
}

const Ctx = createContext<TxContext | null>(null);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TxProvider({ children }: { children: React.ReactNode }) {
  const { address, sign, onTestnet } = useWallet();
  const qc = useQueryClient();
  const [current, setCurrent] = useState<TxState | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);

  const refreshAfter = useCallback(
    async (escrowId: string | undefined, ledger: number) => {
      if (escrowId) {
        // Wait for a read that includes this transaction before the status moves.
        for (let i = 0; i < 5; i++) {
          const view = await getEscrow(BigInt(escrowId)).catch(() => undefined);
          if (view) qc.setQueryData<EscrowView | null>(keys.escrow(escrowId), view);
          if (view && view.escrow.updatedLedger >= ledger) break;
          await sleep(1500);
        }
        void qc.invalidateQueries({ queryKey: keys.history(escrowId) });
      }
      void qc.invalidateQueries({ queryKey: ["party"] });
      void qc.invalidateQueries({ queryKey: ["readiness"] });
      void qc.invalidateQueries({ queryKey: ["trust"] });
      void qc.invalidateQueries({ queryKey: keys.info });
      void qc.invalidateQueries({ queryKey: ["arbiterStats"] });
    },
    [qc],
  );

  const run = useCallback(
    async (opts: RunOptions): Promise<TxResult | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      const id = ++seq.current;
      const method: TxState["method"] =
        opts.job.kind === "invoke" ? opts.job.method : opts.job.kind === "trustline" ? "changeTrust" : "pathPayment";
      const escrowId =
        opts.escrow?.id.toString() ?? undefined;
      const base: TxState = { seq: id, key: opts.key, label: opts.label, method, phase: "checking", escrowId };
      setCurrent(base);
      const update = (patch: Partial<TxState>) => setCurrent((s) => (s && s.seq === id ? { ...s, ...patch } : s));
      const context = { method: method as string, escrow: opts.escrow ?? null };
      try {
        if (opts.job.kind === "invoke") {
          let readiness: Readiness | undefined;
          if (address) {
            readiness = await qc
              .fetchQuery({ queryKey: keys.readiness(address), queryFn: () => getReadiness(address), staleTime: 3_000 })
              .catch(() => undefined);
          }
          const blocked = precheck({
            method: opts.job.method,
            connected: !!address,
            onTestnet,
            readiness,
            amount: opts.amount,
            usdcBalance: balanceStroops(readiness?.usdc?.balance),
            formatAmount: (s) => formatUsdc(s),
          });
          if (blocked) throw blocked;
        } else if (!address) {
          throw precheck({ method: "fund", connected: false, onTestnet, formatAmount: formatUsdc });
        } else if (onTestnet === false) {
          throw precheck({ method: "fund", connected: true, onTestnet, formatAmount: formatUsdc });
        }
        const r: Run = {
          source: address!,
          sign,
          onStage: (stage) => update({ phase: stage }),
          onFee: (fee) => update({ fee }),
        };
        const job = opts.job;
        const result =
          job.kind === "invoke"
            ? await invoke(job.method, job.args, r)
            : job.kind === "trustline"
              ? await addUsdcTrustline(r)
              : await swapXlmForUsdc(job, r);
        // The new escrow's id for create / create_and_fund.
        const createdId =
          job.kind === "invoke" && (job.method === "create" || job.method === "create_and_fund") && result.returnValue !== undefined
            ? String(result.returnValue)
            : undefined;
        await refreshAfter(createdId ?? escrowId, result.ledger);
        update({ phase: "done", result, escrowId: createdId ?? escrowId });
        return result;
      } catch (err) {
        const e = toSisonkeError(err, context);
        if (err instanceof PendingError) e.pending = true;
        update({ phase: "error", error: e });
        if (e.code === 141) void qc.invalidateQueries({ queryKey: keys.info });
        return null;
      } finally {
        busyRef.current = false;
      }
    },
    [address, sign, onTestnet, qc, refreshAfter],
  );

  const clear = useCallback((key?: string) => setCurrent((s) => (!key || s?.key === key ? null : s)), []);

  const probe = useCallback(
    async (method: WriteMethod, args: xdr.ScVal[], escrow: Escrow | null): Promise<ProbeOutcome> => {
      try {
        if (!address) throw new Error("Connect a wallet first");
        const res = await probeCall(method, args, address);
        if (res.ok) return { kind: "would-accept" };
        return { kind: "refused", error: toSisonkeError(new Error(res.error), { method, escrow }), enforced: res.enforced };
      } catch (err) {
        return { kind: "refused", error: toSisonkeError(err, { method, escrow }), enforced: true };
      }
    },
    [address],
  );

  const value = useMemo<TxContext>(
    () => ({
      busy: !!current && current.phase !== "done" && current.phase !== "error",
      current,
      at: (key) => (current?.key === key ? current : null),
      run,
      clear,
      probe,
    }),
    [current, run, clear, probe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTx(): TxContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTx must be used inside <TxProvider>");
  return ctx;
}
