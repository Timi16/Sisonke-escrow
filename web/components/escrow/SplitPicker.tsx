"use client";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatUsdc, parseAmountOrZero, toDecimalString } from "@/lib/sisonke/amount";
import type { Escrow } from "@/lib/sisonke/types";

const PCTS = [0, 25, 50, 75, 100] as const;

/** The recipient's share at a percentage, in stroops. Rounds down: the odd stroop goes to the payer. */
export const shareAt = (amount: bigint, pct: number) => (amount * BigInt(pct)) / 100n;

/** The arbiter's split (WEB_PLAN §6.6): quick percentages or an exact share, 0 ≤ share ≤ amount. */
export function SplitPicker({ escrow, disabled, onAsk }: { escrow: Escrow; disabled: boolean; onAsk: (recipientShare: bigint) => void }) {
  const inputId = useId();
  const total = escrow.amount;
  const [pct, setPct] = useState<number | null>(50);
  const [text, setText] = useState(toDecimalString(shareAt(total, 50)));

  const parsed = parseAmountOrZero(text);
  let error: string | null = null;
  let r: bigint | null = null;
  if (!parsed.ok) error = parsed.error;
  else if (parsed.stroops > total) error = `The recipient's share must be between 0 and ${formatUsdc(total)} USDC.`;
  else r = parsed.stroops;

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!disabled && r !== null) onAsk(r);
      }}
    >
      <span id={`${inputId}-l`} className="text-sm font-bold">
        Recipient gets
      </span>
      <div role="group" aria-labelledby={`${inputId}-l`} className="grid grid-cols-5 gap-1.5">
        {PCTS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pct === p}
            onClick={() => {
              setPct(p);
              setText(toDecimalString(shareAt(total, p)));
            }}
            className={cn("min-h-11 rounded-icon border-[1.5px] text-sm font-bold", pct === p ? "border-violet bg-violet text-white" : "border-line-strong bg-card text-ink")}
          >
            {p}%
          </button>
        ))}
      </div>
      <label htmlFor={inputId} className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted">
        To the recipient
        <span className={cn("flex min-h-10 flex-auto items-center gap-2 rounded-field border-[1.5px] bg-ground px-3 focus-within:border-violet", error ? "border-error" : "border-line")}>
          <input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-invalid={!!error || undefined}
            aria-describedby={`${inputId}-line`}
            onChange={(ev) => {
              setText(ev.target.value);
              setPct(null);
            }}
            className="display tabular min-w-0 flex-auto border-0 bg-transparent text-lg text-ink outline-none focus-visible:outline-none"
          />
          <span aria-hidden="true" className="text-xs font-bold text-muted">
            USDC
          </span>
        </span>
      </label>
      <span id={`${inputId}-line`} role={error ? "alert" : undefined} className={cn("text-sm", error ? "font-semibold text-error" : "text-muted")}>
        {error ??
          (r !== null &&
            `${formatUsdc(r)} USDC to the recipient, ${formatUsdc(total - r)} USDC back to the payer.${r === total ? " Same as a release." : r === 0n ? " Same as a refund." : ""}`)}
      </span>
      <button
        type="submit"
        aria-disabled={disabled || r === null || undefined}
        className={cn("lift-app min-h-[52px] rounded-pill border-0 text-[15px] font-extrabold", disabled || r === null ? "cursor-not-allowed bg-sand text-faint" : "bg-violet text-white")}
      >
        Decide this split
      </button>
    </form>
  );
}
