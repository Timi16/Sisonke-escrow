"use client";

import { useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useMemo, type ReactNode } from "react";
import { parseId } from "@/lib/api";
import { config } from "@/lib/config";
import { formatWhen } from "@/lib/format";
import { keys, useEscrow, useHistory, useInfo } from "@/lib/hooks/queries";
import { ledgerNowFrom, useLedgerClock } from "@/lib/hooks/useLedgerClock";
import { actionsFor } from "@/lib/sisonke/actions";
import { disputeWindowOpen } from "@/lib/sisonke/deadline";
import { roleOf } from "@/lib/sisonke/role";
import type { EscrowAction, EscrowEvent } from "@/lib/sisonke/types";
import { Skeleton, ReadError } from "@/components/ui/Skeleton";
import { useTx } from "@/components/tx/TxProvider";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ActionPanel } from "@/components/escrow/ActionPanel";
import { ActivityList } from "@/components/escrow/ActivityList";
import { BlockedList } from "@/components/escrow/BlockedList";
import { DetailsCard } from "@/components/escrow/DetailsCard";
import { EscrowHeader } from "@/components/escrow/EscrowHeader";
import { MissingEscrow } from "@/components/escrow/MissingEscrow";
import { MoneyStrip } from "@/components/escrow/MoneyStrip";
import { PartiesCard } from "@/components/escrow/PartiesCard";
import { ProgressSteps } from "@/components/escrow/ProgressSteps";

function Main({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex max-w-[1240px] flex-col gap-3.5 px-3.5 pt-2.5 pb-10 min-[720px]:gap-6 min-[720px]:px-6 min-[720px]:pt-9 min-[720px]:pb-24">
      {children}
    </main>
  );
}

const ACTION_OF: Record<string, EscrowAction> = {
  fund: "funded",
  release: "released",
  refund: "refunded",
  reclaim: "reclaimed",
  dispute: "disputed",
  resolve: "resolved",
  cancel: "cancelled",
};

export function EscrowScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = parseId(raw);
  if (id === null) {
    return (
      <Main>
        <MissingEscrow id={raw} />
      </Main>
    );
  }
  return <Escrow id={id} />;
}

function Escrow({ id }: { id: string }) {
  const qc = useQueryClient();
  const { address } = useWallet();
  const escrow = useEscrow(id);
  const info = useInfo();
  const { ledgerNow, reading } = useLedgerClock(1000);
  const tx = useTx();
  const view = escrow.data ?? null;
  const history = useHistory(view?.escrow);

  // When ledger time crosses the deadline, re-read so `deadline_passed` flips from the chain.
  const deadline = view?.escrow.deadline;
  const passed = view?.deadlinePassed;
  useEffect(() => {
    if (deadline === undefined || passed || !reading) return;
    const now = ledgerNowFrom(reading, Date.now());
    if (now === null) return;
    const ms = Math.max(0, (deadline + 6 - now) * 1000);
    if (ms > 2 ** 31 - 1) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: keys.escrow(id) }), ms);
    return () => clearTimeout(t);
  }, [deadline, passed, reading, qc, id]);

  // A just-confirmed transaction's row, until the history refetch includes it.
  const mine = tx.at(`escrow:${id}`);
  const pending = useMemo<EscrowEvent | null>(() => {
    if (!mine || mine.phase !== "done" || !mine.result || !ACTION_OF[mine.method]) return null;
    return {
      id: `pending:${mine.result.hash}`,
      action: ACTION_OF[mine.method],
      txHash: mine.result.hash,
      ledger: mine.result.ledger,
      at: mine.result.createdAt ?? reading?.closeTime ?? 0,
      by: address,
      data: {},
    };
  }, [mine, address, reading]);

  if (escrow.isPending) return <EscrowSkeleton />;
  if (escrow.isError && !view) {
    return (
      <Main>
        <ReadError reason={escrow.error instanceof Error ? escrow.error.message.split("\n")[0].slice(0, 200) : "The read failed."} onRetry={() => void escrow.refetch()} />
      </Main>
    );
  }
  if (!view) {
    return (
      <Main>
        <MissingEscrow id={id} />
      </Main>
    );
  }

  const e = view.escrow;
  const role = roleOf(e, address);
  const contractInfo = info.data?.info ?? null;

  if (e.token !== config.usdcSacId) {
    return (
      <Main>
        <EscrowHeader view={view} role={role} />
        <section role="alert" className="rounded-card border-[1.5px] border-ink bg-card p-[26px] shadow-action">
          <h2 className="m-0 font-serif text-[30px] font-normal leading-none">Unknown token</h2>
          <p className="m-0 mt-3 text-[15px] leading-[1.55] text-muted">This escrow uses a token Sisonke doesn&apos;t recognise. Its amount isn&apos;t shown.</p>
        </section>
        <PartiesCard escrow={e} role={role} />
      </Main>
    );
  }

  const actions = actionsFor({
    status: e.status,
    role,
    deadlinePassed: view.deadlinePassed,
    hasArbiter: !!e.arbiter,
    disputeWindowOpen: disputeWindowOpen(e.deadline, ledgerNow),
    paused: contractInfo?.paused ?? false,
    deadlineText: formatWhen(e.deadline),
  });

  return (
    <Main>
      <EscrowHeader view={view} role={role} />
      <MoneyStrip view={view} role={role} />
      <div className="flex flex-row-reverse flex-wrap items-start gap-3.5 min-[720px]:gap-6">
        <aside aria-label="What you can do" className="rise flex min-w-0 flex-[1_1_360px] flex-col gap-3.5" style={{ animationDelay: "160ms" }}>
          <ActionPanel view={view} role={role} actions={actions} info={contractInfo} ledgerNow={ledgerNow} />
          {role !== "guest" && address && (
            <BlockedList blocked={actions.blocked} escrow={e} role={role} me={address} onAccepted={() => void escrow.refetch()} />
          )}
        </aside>
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5 min-[720px]:gap-6">
          <ProgressSteps status={e.status} className="order-2 min-[720px]:order-1" />
          <PartiesCard escrow={e} role={role} className="order-1 min-[720px]:order-2" />
          <DetailsCard view={view} role={role} ledgerNow={ledgerNow} className="order-4 min-[720px]:order-3" />
          <ActivityList
            className="order-3 min-[720px]:order-4"
            escrow={e}
            history={history.data}
            loading={history.isPending}
            failed={history.isError}
            onRetry={() => void history.refetch()}
            me={address}
            pending={pending}
          />
        </div>
      </div>
    </Main>
  );
}

/** Skeleton shaped like the final layout. */
export function EscrowSkeleton() {
  return (
    <Main>
      <span className="sr-only" role="status">
        Loading the escrow from Stellar…
      </span>
      <Skeleton className="hidden h-5 w-48 min-[720px]:block" />
      <div className="flex flex-wrap items-center gap-3.5">
        <Skeleton className="h-[38px] w-64 min-[720px]:h-16 min-[720px]:w-[420px]" />
        <Skeleton className="h-9 w-32 rounded-pill" />
      </div>
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-[220px] w-full rounded-panel" />
      <div className="flex flex-row-reverse flex-wrap items-start gap-3.5 min-[720px]:gap-6">
        <div className="flex flex-[1_1_360px] flex-col gap-3.5">
          <Skeleton className="h-[300px] rounded-card" />
          <Skeleton className="h-[160px] rounded-tile" />
        </div>
        <div className="flex flex-[999_1_560px] flex-col gap-6">
          <Skeleton className="h-[120px] rounded-card" />
          <Skeleton className="h-[220px] rounded-card" />
          <Skeleton className="h-[180px] rounded-card" />
        </div>
      </div>
    </Main>
  );
}

