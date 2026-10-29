"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { explorer } from "@/lib/config";
import { groupInt } from "@/lib/format";
import { formatXlm } from "@/lib/sisonke/amount";
import type { TxResult as Result } from "@/lib/stellar/tx";

/** Confirmed: Done, the explorer link, the full hash, ledger and fee. Focus moves here. */
export function TxResult({ result, onDone, onInk = false, doneLabel = "Done" }: { result: Result; onDone?: () => void; onInk?: boolean; doneLabel?: string }) {
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="slidein flex flex-col gap-3">
      <p ref={heading} tabIndex={-1} className={cn("m-0 text-[15px] font-bold outline-none", onInk ? "text-on-ink" : "text-ink")}>
        Confirmed on Stellar.
      </p>
      <p className={cn("m-0 break-all font-mono text-xs", onInk ? "text-on-ink-muted" : "text-muted")}>{result.hash}</p>
      <p className={cn("m-0 text-[13px]", onInk ? "text-on-ink-muted" : "text-muted")}>
        Ledger {groupInt(result.ledger)}
        {result.feeCharged !== null && <> · Fee {formatXlm(result.feeCharged)} XLM</>}
      </p>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5">
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className={cn("min-h-[46px] rounded-pill border-0 px-6 text-[15px] font-bold", onInk ? "bg-lime text-ink" : "bg-ink text-on-ink")}
          >
            {doneLabel}
          </button>
        )}
        <a
          href={explorer.tx(result.hash)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open transaction ${result.hash} on Stellar Expert`}
          className={cn("inline-flex min-h-11 items-center text-sm font-bold", onInk ? "text-lilac hover:text-lilac" : "text-violet hover:text-violet")}
        >
          Open on Stellar Expert
        </a>
      </div>
    </div>
  );
}
