"use client";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { FriendlyError } from "@/lib/sisonke/errors";
import { BangIcon } from "@/components/ui/icons";
import { TxHash } from "@/components/ui/TxHash";

/** The board's error block (shake): title, body, optional fix, Try again, failed tx hash. */
export function TxError({
  error,
  onRetry,
  onFix,
  onInk = false,
}: {
  error: FriendlyError;
  onRetry: () => void;
  /** In-app fixes (Run the migration). */
  onFix?: (action: "migrate") => void;
  onInk?: boolean;
}) {
  return (
    <div role="alert" className="shake flex flex-col gap-3.5">
      <span className="flex size-[52px] items-center justify-center self-start rounded-pill border-[1.5px] border-error bg-error-bg">
        <BangIcon />
      </span>
      <h2 className={cn("m-0 font-serif text-[32px] font-normal leading-[1.05]", onInk && "text-on-ink")}>{error.title}</h2>
      <p className={cn("m-0 text-[15px] leading-[1.55]", onInk ? "text-on-ink-muted" : "text-muted")}>{error.body}</p>
      {error.hash && (
        <p className={cn("m-0 flex flex-wrap items-center gap-2 text-[13px]", onInk ? "text-on-ink-muted" : "text-muted")}>
          Failed on-chain in <TxHash hash={error.hash} className={onInk ? "!text-lilac" : undefined} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {error.fix?.href && error.fix.href.startsWith("/") && (
          <Link
            href={error.fix.href}
            className="lift inline-flex min-h-12 items-center rounded-pill border-[1.5px] border-ink bg-lime px-[22px] text-[15px] font-bold text-ink no-underline hover:text-ink"
          >
            {error.fix.label}
          </Link>
        )}
        {error.fix?.action && onFix && (
          <button
            type="button"
            onClick={() => onFix(error.fix!.action!)}
            className="lift inline-flex min-h-12 items-center rounded-pill border-[1.5px] border-ink bg-lime px-[22px] text-[15px] font-bold text-ink"
          >
            {error.fix.label}
          </button>
        )}
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "min-h-12 rounded-pill border-[1.5px] bg-transparent px-5 text-[15px] font-bold",
            onInk ? "border-ink-btn-line text-on-ink" : "border-ink text-ink",
          )}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
