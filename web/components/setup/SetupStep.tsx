import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/ui/icons";

export type StepState = "next" | "busy" | "done" | "locked";

/** One numbered setup card (Setup board): up next, working, done or locked. */
export function SetupStep({
  n,
  title,
  status,
  state,
  delay,
  children,
}: {
  n: number;
  title: string;
  /** "Up next", "Waiting on the step above", "Working…", "Done", "Waiting for your wallet…" */
  status: string;
  state: StepState;
  delay: number;
  children: ReactNode;
}) {
  const done = state === "done";
  return (
    <li
      className={cn(
        "rise flex gap-[18px] rounded-[24px] border-[1.5px] bg-card p-6 transition-[opacity,border-color,box-shadow] duration-300",
        done ? "border-line" : state === "locked" ? "border-line opacity-60" : "border-ink shadow-step-active",
      )}
      style={{ animationDelay: `${delay}ms` }}
      aria-labelledby={`step-${n}-title`}
    >
      {done ? (
        <span className="pop-strong flex size-10 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-ink bg-lime">
          <CheckIcon size={18} strokeWidth={2.6} />
          <span className="sr-only">Step {n} done</span>
        </span>
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-ink font-bold">
          <span className="sr-only">Step </span>
          {n}
        </span>
      )}
      <div className="flex min-w-0 flex-auto flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <h2 id={`step-${n}-title`} className="m-0 text-xl font-bold">
            {title}
          </h2>
          <span className="text-[13px] font-semibold text-muted" aria-live="polite">
            {status}
          </span>
        </div>
        {children}
      </div>
    </li>
  );
}

/** The step's main button: lime when ready, sand when locked. */
export function StepButton({
  onClick,
  disabled,
  busy,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled || busy ? undefined : onClick}
      aria-disabled={disabled || busy || undefined}
      className={cn(
        "inline-flex min-h-12 items-center gap-2.5 self-start rounded-pill border-0 px-[22px] text-[15px] font-bold",
        disabled ? "cursor-not-allowed bg-sand text-faint" : "bg-lime text-ink",
        busy && "cursor-wait",
      )}
    >
      {busy && (
        <svg className="spin" width="16" height="16" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="10" stroke="var(--color-line-strong)" strokeWidth="3" fill="none" />
          <path d="M13 3 A10 10 0 0 1 23 13" stroke="var(--color-ink)" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
