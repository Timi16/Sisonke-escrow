"use client";
import { cn } from "@/lib/cn";
import { explorer } from "@/lib/config";
import { formatWhen } from "@/lib/format";
import { formatUsdc } from "@/lib/sisonke/amount";
import type { Escrow, EscrowAction, EscrowEvent, EscrowHistory } from "@/lib/sisonke/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { TxHash } from "@/components/ui/TxHash";

const DOT: Record<EscrowAction, string> = {
  created: "border-ink bg-card",
  funded: "border-ink bg-lime",
  released: "border-ink bg-ink",
  refunded: "border-ink bg-sand",
  reclaimed: "border-ink bg-sand",
  disputed: "border-ink bg-violet",
  resolved: "border-ink bg-[linear-gradient(90deg,var(--color-lime)_50%,var(--color-card)_50%)]",
  cancelled: "border-line-strong bg-card",
};

/** Titles use the escrow record for amounts, never the event data (INTEGRATION §4). */
function title(ev: EscrowEvent, e: Escrow): string {
  switch (ev.action) {
    case "created":
      return "Escrow created";
    case "funded":
      return `${formatUsdc(e.amount)} USDC locked in`;
    case "released":
      return "Released to the recipient";
    case "refunded":
      return "Refunded to the payer";
    case "reclaimed":
      return "Taken back by the payer after the deadline";
    case "disputed":
      return "Dispute opened";
    case "resolved":
      return `Arbiter decided: ${formatUsdc(e.paidToRecipient)} to the recipient, ${formatUsdc(e.paidToPayer)} to the payer`;
    case "cancelled":
      return "Cancelled before any deposit";
  }
}

function signedBy(ev: EscrowEvent, e: Escrow, me: string | null): string {
  if (ev.by && me && ev.by === me) return "You signed";
  if (ev.action === "disputed") return ev.by === e.recipient ? "Recipient signed" : "Payer signed";
  if (ev.action === "refunded") return "Recipient signed";
  if (ev.action === "resolved") return "Arbiter signed";
  return "Payer signed";
}

/** Events with transaction links, oldest first, plus the retention fallback note. */
export function ActivityList({
  escrow,
  history,
  loading,
  failed,
  onRetry,
  me,
  pending,
  className,
}: {
  escrow: Escrow;
  history: EscrowHistory | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  me: string | null;
  /** A just-confirmed transaction, shown until the history refetch includes it. */
  pending: EscrowEvent | null;
  className?: string;
}) {
  const events = [...(history?.events ?? [])];
  if (pending && !events.some((ev) => ev.txHash && ev.txHash === pending.txHash)) {
    // Replace a rebuilt "stored" row for the same step, if any.
    const i = events.findIndex((ev) => ev.action === pending.action && !ev.txHash);
    if (i >= 0) events.splice(i, 1);
    events.push(pending);
  }
  return (
    <section aria-labelledby="activity-h" className={cn("rise flex flex-col gap-1 rounded-tile border border-line bg-card p-[18px] min-[720px]:rounded-card min-[720px]:px-[26px] min-[720px]:py-6", className)} style={{ animationDelay: "280ms" }}>
      <h2 id="activity-h" className="m-0 mb-2 text-sm font-bold min-[720px]:text-base">
        Activity
      </h2>
      {loading && !history ? (
        <div className="flex flex-col gap-3 border-t border-sand pt-3.5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      ) : failed && !history ? (
        <p className="m-0 flex flex-wrap items-center gap-3 border-t border-sand pt-3.5 text-sm text-muted">
          Couldn&apos;t load the history from Stellar.
          <button type="button" onClick={onRetry} className="min-h-11 px-0.5 text-[13px] font-bold text-violet">
            Try again
          </button>
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {events.map((ev) => (
            <li key={ev.id} className="slidein flex gap-3 border-t border-sand py-3 min-[720px]:gap-3.5 min-[720px]:py-3.5">
              <span aria-hidden="true" className={cn("mt-[5px] size-2.5 shrink-0 rounded-pill border-2 min-[720px]:size-3", DOT[ev.action])} />
              <div className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-4 gap-y-1">
                <div className="flex flex-col gap-[3px]">
                  <span className="text-sm font-bold min-[720px]:text-[15px]">{title(ev, escrow)}</span>
                  <span className="text-xs text-muted min-[720px]:text-[13px]">
                    {signedBy(ev, escrow, me)}, {formatWhen(ev.at)}
                  </span>
                </div>
                {ev.txHash ? (
                  <TxHash hash={ev.txHash} className="self-start text-xs min-[720px]:text-[13px]" />
                ) : (
                  <span className="self-start text-xs text-muted">From the contract record</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {history?.truncated && (
        <p className="m-0 border-t border-sand pt-3 text-[13px] leading-normal text-muted">
          Older steps are past the ~7-day window Stellar&apos;s RPC keeps. Their times come from the contract record.{" "}
          <a href={explorer.contract()} target="_blank" rel="noopener noreferrer" className="font-bold text-violet">
            See every transaction on Stellar Expert.
          </a>
        </p>
      )}
    </section>
  );
}
