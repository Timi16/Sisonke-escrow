import { cn } from "@/lib/cn";
import { DEADLINE_PASSED_LABEL, STATUS_LABEL } from "@/lib/sisonke/status";
import type { Status } from "@/lib/sisonke/types";

export type ChipSize = "header" | "row" | "compact";

const SIZE: Record<ChipSize, string> = {
  header: "min-h-9 px-4 text-[15px]",
  row: "min-h-8 px-3.5 text-[13px]",
  compact: "min-h-[26px] px-[11px] text-xs",
};

const LOOK: Record<Status | "deadline", string> = {
  Created: "border-dashed border-ink bg-transparent text-ink",
  Funded: "border-ink bg-lime text-ink",
  Disputed: "border-ink bg-violet text-white",
  Released: "border-ink bg-ink text-on-ink",
  Refunded: "border-ink bg-card text-ink",
  Split: "border-ink bg-sand text-ink",
  Cancelled: "border-line-strong bg-transparent text-muted",
  deadline: "border-error bg-error-bg text-error",
};

/** One chip per status, used on every page. Starts with a hidden "Status: ". */
export function StatusChip({
  status,
  size = "row",
  className,
  pop = false,
}: {
  status: Status | "deadline";
  size?: ChipSize;
  className?: string;
  pop?: boolean;
}) {
  const label = status === "deadline" ? DEADLINE_PASSED_LABEL : STATUS_LABEL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-pill border-[1.5px] font-bold",
        SIZE[size],
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

/** The status chip plus the "Deadline passed" modifier when it applies. */
export function StatusChips({ status, deadlinePassed, size = "row", pop }: { status: Status; deadlinePassed: boolean; size?: ChipSize; pop?: boolean }) {
  const showDeadline = deadlinePassed && (status === "Created" || status === "Funded");
  return (
    <>
      <StatusChip key={status} status={status} size={size} pop={pop} />
      {showDeadline && <StatusChip status="deadline" size={size} pop={pop} />}
    </>
  );
}
