import { cn } from "@/lib/cn";
import { progressSteps } from "@/lib/sisonke/status";
import type { Status } from "@/lib/sisonke/types";
import { CheckIcon } from "@/components/ui/icons";

/** Created → Funded → final (Escrow board "Progress"). Cancelled hides the third step. */
export function ProgressSteps({ status, className }: { status: Status; className?: string }) {
  const steps = progressSteps(status);
  return (
    <section aria-label="Progress" className={cn("flex flex-col gap-3 rounded-tile border border-line bg-card p-[18px] min-[720px]:rounded-card min-[720px]:px-[26px] min-[720px]:py-6", className)}>
      <ol className={cn("m-0 grid list-none p-0", steps.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {steps.map((s, i) => {
          const reached = s.state !== "todo";
          const last = i === steps.length - 1;
          const mark =
            s.state === "current"
              ? s.dispute
                ? "border-ink bg-violet text-white"
                : "border-ink bg-lime text-ink"
              : s.state === "done"
                ? "border-ink bg-ink text-on-ink"
                : "border-line-strong bg-transparent text-muted";
          return (
            <li key={s.label} className="flex flex-col gap-2 min-[720px]:gap-2.5">
              <div className="flex items-center gap-1.5 pr-1.5 min-[720px]:gap-2.5 min-[720px]:pr-2.5">
                <span
                  className={cn(
                    "flex size-[26px] shrink-0 items-center justify-center rounded-pill border-[1.5px] text-xs font-bold transition-colors duration-400 min-[720px]:size-8 min-[720px]:text-sm",
                    mark,
                  )}
                >
                  {reached ? <CheckIcon size={14} strokeWidth={2.8} className="pop" /> : i + 1}
                  <span className="sr-only">{s.state === "todo" ? " (not yet)" : s.state === "current" ? " (now)" : " (done)"}</span>
                </span>
                <span className={cn("h-[3px] flex-1 overflow-hidden rounded-pill bg-sand min-[720px]:h-1", last && "invisible")}>
                  <span className="step-bar block h-full bg-ink" style={{ width: s.state === "done" ? "100%" : "0%" }} />
                </span>
              </div>
              <span className={cn("text-xs font-bold min-[720px]:text-[15px]", reached ? "text-ink" : "text-muted")}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-[13px] text-muted">Status changes only after Stellar confirms the transaction.</p>
    </section>
  );
}
