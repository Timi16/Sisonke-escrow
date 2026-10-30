import Link from "next/link";
import { cn } from "@/lib/cn";
import { padId } from "@/lib/format";
import { formatUsdc } from "@/lib/sisonke/amount";
import { ROLE_LABEL, whenText, type Mine } from "@/lib/sisonke/overview";
import { displayTitle } from "@/lib/sisonke/title";
import { AppChips } from "@/components/ui/AppChip";
import { Ph } from "@/components/ui/Skeleton";

const HEAD = "text-xs font-bold tracking-[0.08em] text-muted uppercase";

/** Column names (decorative: each row reads as one link). Hidden on phones. */
export function TableHead() {
  return (
    <div aria-hidden="true" className="trow border-b border-line px-[18px] pb-2.5 max-[880px]:hidden">
      <span className={HEAD}>Escrow</span>
      <span className={cn(HEAD, "thide")}>Role</span>
      <span className={cn(HEAD, "text-right")}>Amount</span>
      <span className={HEAD}>Status</span>
      <span className={cn(HEAD, "thide text-right")}>Deadline</span>
    </div>
  );
}

/** One escrow as a table row; the whole row links to its page. A violet dot marks "needs action". */
export function EscrowLine({ mine, need, tokenOk, muted = false }: { mine: Mine; need: boolean; tokenOk: boolean; muted?: boolean }) {
  const e = mine.view.escrow;
  const t = displayTitle(e.title);
  return (
    <li>
      <Link
        href={`/escrow/${e.id.toString()}`}
        className={cn("row-link trow border-b border-sand px-[18px] py-3.5 text-ink no-underline hover:text-ink", muted && "opacity-60")}
      >
        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="flex items-center gap-2 font-mono text-xs text-muted">
            {need && <span aria-hidden="true" className="pulse size-[7px] shrink-0 rounded-pill bg-violet" />}
            {need && <span className="sr-only">Needs action: </span>}
            {padId(e.id)}
          </span>
          <span className={cn("truncate text-[15px] font-bold", t.empty && "font-semibold text-muted")} title={t.text}>
            {t.empty ? "Untitled escrow" : t.text}
          </span>
        </span>
        <span className="thide text-sm text-muted">{ROLE_LABEL[mine.role]}</span>
        <span className="flex items-baseline justify-end gap-[5px] whitespace-nowrap">
          {tokenOk ? (
            <>
              <span className="display tabular text-lg">{formatUsdc(e.amount)}</span>
              <span className="text-[11px] font-bold text-muted">USDC</span>
            </>
          ) : (
            <span className="text-xs font-semibold text-muted">Unknown token</span>
          )}
        </span>
        <span className="flex min-w-0 flex-wrap gap-1">
          <AppChips status={e.status} deadlinePassed={mine.view.deadlinePassed} />
        </span>
        <span className="thide text-right text-sm text-muted">{whenText(mine)}</span>
      </Link>
    </li>
  );
}

/** Placeholder rows: static with no wallet, shimmering while reading. */
export function PlaceholderRows({ moving, count = 4 }: { moving: boolean; count?: number }) {
  const widths = ["62%", "48%", "56%", "40%", "52%", "44%"];
  return (
    <ul aria-hidden="true" className="m-0 list-none p-0">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="trow border-b border-sand px-[18px] py-4">
          <span className="flex flex-col gap-2">
            <Ph moving={moving} className="h-2.5 w-11" />
            <Ph moving={moving} className="h-3.5" style={{ width: widths[i % widths.length] }} />
          </span>
          <Ph moving={moving} className="thide h-3 w-[60%]" />
          <Ph moving={moving} className="h-[18px] w-[70%] justify-self-end" />
          <Ph moving={moving} className="h-6 w-[84px] rounded-pill" />
          <Ph moving={moving} className="thide h-3 w-1/2 justify-self-end" />
        </li>
      ))}
    </ul>
  );
}
