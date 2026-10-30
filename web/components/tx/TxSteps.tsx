"use client";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { formatXlm } from "@/lib/sisonke/amount";
import { CheckIcon, InkSpinner } from "@/components/ui/icons";
import type { Phase, TxState } from "./TxProvider";

const AT: Record<Phase, number> = { checking: 0, signing: 1, submitting: 2, confirming: 2, done: 4, error: -1 };

/**
 * Simulating → Approve in <wallet> → Submitting → Confirmed, on a dark panel.
 * The wallet shows its own prompt: this only says what to look for there.
 */
export function TxSteps({ tx, walletName, className }: { tx: TxState; walletName: string | null; className?: string }) {
  const at = AT[tx.phase];
  const wallet = walletName ?? "your wallet";
  const steps = ["Simulating", `Approve in ${wallet}`, "Submitting", "Confirmed"];
  const isContract = tx.method !== "changeTrust" && tx.method !== "pathPayment";
  return (
    <div className={cn("slidein flex flex-col gap-3 rounded-[18px] bg-ink-2 p-4 text-on-ink", className)}>
      <ol aria-live="polite" aria-label="Progress" className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((label, i) => {
          const done = at > i;
          const now = at === i;
          return (
            <li key={label} className={cn("flex items-center gap-3 text-sm", done || now ? "font-bold text-on-ink" : "text-faint")}>
              <span className="flex size-5 shrink-0 items-center justify-center">
                {done ? (
                  <CheckIcon size={18} className="pop text-lime" />
                ) : now ? (
                  <InkSpinner size={20} />
                ) : (
                  <span className="size-5 rounded-pill border-2 border-ink-line" />
                )}
              </span>
              <span>
                {label}
                {now && <span className="sr-only"> (in progress)</span>}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {tx.phase === "signing" && (
        <p className="m-0 border-t border-ink-line pt-3 text-xs leading-normal text-on-ink-muted">
          {wallet.charAt(0).toUpperCase() + wallet.slice(1)} shows <span className="font-mono text-on-ink">{tx.method}</span>
          {isContract && (
            <>
              {" "}
              on <span className="font-mono text-on-ink">{shortAddress(config.contractId)}</span>
            </>
          )}
          , Stellar Testnet{tx.fee !== undefined && <>, fee ≈ {formatXlm(tx.fee)} XLM</>}. Approve or reject it there.
        </p>
      )}
    </div>
  );
}
