"use client";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { padId, shortAddress, shortHash } from "@/lib/format";
import { formatXlm } from "@/lib/sisonke/amount";
import { DoneMark, Spinner } from "@/components/ui/icons";
import type { Phase, TxState } from "./TxProvider";

const ORDER: Phase[] = ["checking", "signing", "submitting", "confirming", "done"];

/**
 * The 4-step list, plus the dark "waiting for your wallet" card while the
 * wallet is open. An honest summary, not a fake wallet: approving and
 * rejecting happen in the wallet itself.
 */
export function TxProgress({
  tx,
  walletName,
  source,
  onInk = false,
  statusNote,
  showTitle = true,
}: {
  tx: TxState;
  walletName: string | null;
  source: string | null;
  onInk?: boolean;
  /** Replaces the sub-lines of steps 3 and 4 (Create: "Status: Funded."). */
  statusNote?: string;
  showTitle?: boolean;
}) {
  const at = ORDER.indexOf(tx.phase);
  const wallet = walletName ?? "Your wallet";
  const steps = [
    { label: "Checking with the contract", sub: "A free dry run. Nothing is signed yet." },
    { label: "Approve in your wallet", sub: `${wallet} shows exactly what you're signing.` },
    { label: "Sending to Stellar", sub: statusNote ?? "Usually takes a few seconds." },
    {
      label: "Confirmed",
      sub:
        tx.phase === "done" && tx.result
          ? `Status updated. Transaction ${shortHash(tx.result.hash)}.`
          : statusNote ?? "Waiting for the next ledger.",
    },
  ];
  return (
    <div className="slidein flex flex-col gap-4">
      {showTitle && (
        <h2 className={cn("m-0 font-serif text-[34px] font-normal leading-none", onInk && "text-on-ink")}>{tx.label}</h2>
      )}
      {tx.phase === "signing" && (
        <div className={cn("pop flex flex-col gap-3.5 rounded-tile p-[18px]", onInk ? "border border-ink-line bg-ink-2" : "bg-ink", "text-on-ink")}>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="display flex size-[38px] shrink-0 items-center justify-center rounded-icon bg-lime text-lg text-ink">
              {wallet.charAt(0).toUpperCase()}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-on-ink-muted">{wallet} is asking you to sign</span>
              <span className="text-base font-bold">{tx.label}</span>
            </div>
          </div>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[13px]">
            <dt className="text-on-ink-muted">Function</dt>
            <dd className="m-0 font-mono">{tx.method}</dd>
            {tx.escrowId && (
              <>
                <dt className="text-on-ink-muted">Escrow</dt>
                <dd className="m-0 font-mono">{padId(tx.escrowId)}</dd>
              </>
            )}
            {tx.method !== "changeTrust" && tx.method !== "pathPayment" && (
              <>
                <dt className="text-on-ink-muted">Contract</dt>
                <dd className="m-0 font-mono" title={config.contractId}>
                  {shortAddress(config.contractId)}
                </dd>
              </>
            )}
            {source && (
              <>
                <dt className="text-on-ink-muted">From</dt>
                <dd className="m-0 font-mono">{shortAddress(source)}</dd>
              </>
            )}
            <dt className="text-on-ink-muted">Network</dt>
            <dd className="m-0">Stellar Testnet</dd>
            {tx.fee !== undefined && (
              <>
                <dt className="text-on-ink-muted">Fee</dt>
                <dd className="m-0 tabular">≈ {formatXlm(tx.fee)} XLM</dd>
              </>
            )}
          </dl>
          <p className="m-0 text-xs text-on-ink-muted">Approve or reject it in {wallet}.</p>
        </div>
      )}
      <ol aria-live="polite" aria-label="Progress" className="m-0 flex list-none flex-col gap-3.5 p-0">
        {steps.map((s, i) => {
          const done = at > i || tx.phase === "done";
          const active = at === i && tx.phase !== "done";
          return (
            <li key={s.label} className="flex items-start gap-3.5">
              <span className="flex size-[26px] shrink-0 items-center justify-center">
                {done ? (
                  <DoneMark className="pop" />
                ) : active ? (
                  <Spinner track={onInk ? "var(--color-ink-line)" : "var(--color-sand)"} />
                ) : (
                  <span className="size-5 rounded-pill border-[1.5px] border-line-strong" />
                )}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className={cn("text-[15px] font-bold", !done && !active ? "text-faint" : onInk ? "text-on-ink" : "text-ink")}>
                  {s.label}
                  {active && <span className="sr-only"> (in progress)</span>}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
                <span className={cn("text-[13px]", onInk ? "text-on-ink-muted" : "text-muted")}>{s.sub}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
