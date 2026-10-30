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
import { Ph, ReadError } from "@/components/ui/Skeleton";
import { useTx } from "@/components/tx/TxProvider";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ActivityList } from "@/components/escrow/ActivityList";
import { BlockedList } from "@/components/escrow/BlockedList";
import { BackLink, EscrowHeader } from "@/components/escrow/EscrowHeader";
import { FactsCard } from "@/components/escrow/FactsCard";
import { MissingEscrow } from "@/components/escrow/MissingEscrow";
import { MoneyCard } from "@/components/escrow/MoneyCard";
import { MoveCard } from "@/components/escrow/MoveCard";
import { WhoCan } from "@/components/escrow/WhoCan";

function Main({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex flex-col gap-[22px]">
      <BackLink />
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
        <section role="alert" className="rounded-panel border-2 border-ink bg-card p-[22px] shadow-action">
          <h2 className="m-0 font-serif text-2xl font-normal leading-none">Unknown token</h2>
          <p className="m-0 mt-3 text-sm leading-normal text-muted">This escrow uses a token Sisonke doesn&apos;t recognise. Its amount and actions aren&apos;t shown.</p>
        </section>
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
      <MoneyCard view={view} role={role} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-[999_1_440px] flex-col gap-3">
          <FactsCard view={view} role={role} ledgerNow={ledgerNow} />
          <ActivityList
            escrow={e}
            history={history.data}
            loading={history.isPending}
            failed={history.isError}
            onRetry={() => void history.refetch()}
            me={address}
            pending={pending}
          />
        </div>
        <aside aria-label="What you can do" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <MoveCard view={view} role={role} actions={actions} info={contractInfo} ledgerNow={ledgerNow} />
          <WhoCan escrow={e} role={role} />
          {role !== "guest" && address && (
            <BlockedList blocked={actions.blocked} escrow={e} role={role} me={address} onAccepted={() => void escrow.refetch()} />
          )}
        </aside>
      </div>
    </Main>
  );
}

/** Skeleton shaped like the final layout, shimmering while the read is in flight. */
export function EscrowSkeleton() {
  return (
    <Main>
      <span className="sr-only" role="status">
        Loading the escrow from Stellar…
      </span>
      <div className="flex flex-wrap items-center gap-3.5">
        <Ph moving className="h-[38px] w-64" />
        <Ph moving className="h-[34px] w-28 rounded-pill" />
      </div>
      <Ph moving className="h-6 w-56" />
      <Ph moving className="h-[200px] w-full rounded-shell" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-[999_1_440px] flex-col gap-3">
          <Ph moving className="h-[220px] rounded-panel" />
          <Ph moving className="h-[180px] rounded-panel" />
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <Ph moving className="h-[260px] rounded-panel" />
          <Ph moving className="h-[200px] rounded-panel" />
        </div>
      </div>
    </Main>
  );
}
