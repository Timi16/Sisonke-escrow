import Link from "next/link";
import { cn } from "@/lib/cn";
import { padId, shortAddress } from "@/lib/format";
import { formatUsdc } from "@/lib/sisonke/amount";
import { rowHint, type Tab } from "@/lib/sisonke/status";
import { displayTitle } from "@/lib/sisonke/title";
import { isFinal, type EscrowView } from "@/lib/sisonke/types";
import { ChevronRight } from "@/components/ui/icons";
import { StatusChips } from "@/components/ui/StatusChip";

/** One dashboard row: the whole row links to the escrow (Dashboard board). */
export function EscrowRow({
  view,
  tab,
  tokenOk,
  upgradePending,
  hidden,
  onToggleHide,
  delay = 0,
}: {
  view: EscrowView;
  tab: Tab;
  tokenOk: boolean;
  upgradePending: boolean;
  hidden: boolean;
  onToggleHide: () => void;
  delay?: number;
}) {
  const e = view.escrow;
  const t = displayTitle(e.title);
  const hint = rowHint(view, tab);
  const id = e.id.toString();
  return (
    <li className="rise-fast relative" style={{ animationDelay: `${delay}ms` }}>
      <Link
        href={`/escrow/${id}`}
        className="lift-row flex flex-wrap items-center gap-x-6 gap-y-3.5 rounded-tile border-[1.5px] border-line bg-card px-[22px] py-5 text-ink no-underline hover:text-ink"
      >
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1 pr-14">
          <span className="inline-flex items-center gap-2 font-mono text-xs text-muted">
            {padId(e.id)}
            {upgradePending && !isFinal(e.status) && (
              <span className="inline-flex items-center gap-1 font-sans font-semibold text-violet">
                <span aria-hidden="true" className="size-[7px] rounded-pill bg-violet" />
                Upgrade pending
              </span>
            )}
          </span>
          <span className={cn("truncate text-lg font-bold", t.empty && "font-semibold text-muted")} title={t.text}>
            {t.empty ? "Untitled escrow" : t.text}
          </span>
          <span className="text-sm text-muted">
            {tab === "paying" && (
              <>
                to <span className="font-mono text-xs">{shortAddress(e.recipient)}</span>
              </>
            )}
            {tab === "receiving" && (
              <>
                from <span className="font-mono text-xs">{shortAddress(e.payer)}</span>
              </>
            )}
            {tab === "arbiter" && (
              <>
                between <span className="font-mono text-xs">{shortAddress(e.payer)}</span> and{" "}
                <span className="font-mono text-xs">{shortAddress(e.recipient)}</span>
              </>
            )}
          </span>
        </div>
        <div className="flex min-w-[130px] flex-none items-baseline gap-1.5">
          {tokenOk ? (
            <>
              <span className="display tabular text-[30px]">{formatUsdc(e.amount)}</span>
              <span className="text-[13px] font-semibold text-muted">USDC</span>
            </>
          ) : (
            <span className="text-sm font-semibold text-muted">Unknown token, amount hidden</span>
          )}
        </div>
        <span className="flex flex-none flex-wrap gap-2">
          <StatusChips status={e.status} deadlinePassed={view.deadlinePassed} size="row" />
        </span>
        <div className="flex flex-[1_1_200px] items-center justify-end gap-3">
          {hint.needsYou && <span aria-hidden="true" className="pulse size-[9px] shrink-0 rounded-pill bg-violet" />}
          <span className={cn("text-right text-sm font-semibold", hint.needsYou ? "text-ink" : "text-muted")}>
            {hint.needsYou && <span className="sr-only">Needs you: </span>}
            {hint.text}
          </span>
          <ChevronRight size={18} className="chev shrink-0" />
        </div>
      </Link>
      <button
        type="button"
        onClick={onToggleHide}
        aria-label={`${hidden ? "Unhide" : "Hide"} escrow ${padId(e.id)} ${hidden ? "in" : "from"} my list`}
        className="absolute top-1 right-2 min-h-11 rounded-pill bg-transparent px-2.5 text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink"
      >
        {hidden ? "Unhide" : "Hide"}
      </button>
    </li>
  );
}
