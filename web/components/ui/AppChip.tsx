import { cn } from "@/lib/cn";
import { APP_STATUS_LABEL, DEADLINE_PASSED_LABEL } from "@/lib/sisonke/status";
import type { Status } from "@/lib/sisonke/types";

/** The app boards' chip looks (docs/design/app). The site pages keep StatusChip. */
const LOOK: Record<Status | "deadline", string> = {
  Created: "border-dashed border-faint bg-transparent text-muted",
  Funded: "border-ink bg-lime text-ink",
  Disputed: "border-violet bg-violet text-white",
  Released: "border-ink bg-ink text-on-ink",
  Refunded: "border-line bg-line text-ink",
  Split: "border-violet bg-card text-violet",
  Cancelled: "border-line bg-sand text-muted",
  deadline: "border-error bg-error-bg text-error",
};

/** One status chip on app pages. Starts with a hidden "Status: ". */
export function AppChip({ status, big = false, pop = false, className }: { status: Status | "deadline"; big?: boolean; pop?: boolean; className?: string }) {
  const label = status === "deadline" ? DEADLINE_PASSED_LABEL : APP_STATUS_LABEL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-self-start whitespace-nowrap rounded-pill border-[1.5px] font-bold",
        big ? "min-h-[34px] px-3 text-sm" : "min-h-[26px] px-2.5 text-xs",
        LOOK[status],
        pop && "pop",
        className,
      )}
    >
      <span className="sr-only">{status === "deadline" ? "" : "Status: "}</span>
      {label}
    </span>
  );
}

/** The chip plus "Deadline passed" when it applies (open, deadline-bound statuses). */
export function AppChips({ status, deadlinePassed, big, pop }: { status: Status; deadlinePassed: boolean; big?: boolean; pop?: boolean }) {
  const late = deadlinePassed && (status === "Created" || status === "Funded");
  return (
    <>
      <AppChip key={status} status={status} big={big} pop={pop} />
      {late && <AppChip status="deadline" big={big} pop={pop} />}
    </>
  );
}
