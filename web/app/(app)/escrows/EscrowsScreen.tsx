"use client";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useMyEscrows } from "@/lib/hooks/useMyEscrows";
import { toSisonkeError } from "@/lib/sisonke/errors";
import { FILTERS, matches, needsAction, type Filter } from "@/lib/sisonke/overview";
import { EscrowLine, PlaceholderRows, TableHead } from "@/components/app/EscrowTable";
import { PageHead } from "@/components/app/PageHead";
import { DriftRings, PlusBold, WalletIcon } from "@/components/ui/icons";
import { Ph, ReadError } from "@/components/ui/Skeleton";
import { useWallet } from "@/components/wallet/WalletProvider";

function NewButton() {
  return (
    <Link href="/new" className="lift-app inline-flex min-h-12 items-center gap-2 rounded-pill bg-ink px-5 text-sm font-extrabold text-on-ink no-underline hover:text-on-ink">
      <PlusBold size={14} />
      New escrow
    </Link>
  );
}

function ConnectCard() {
  const { openConnect } = useWallet();
  return (
    <section className="rise flex flex-col items-center gap-4 rounded-card border border-line bg-card px-6 py-14 text-center" style={{ animationDelay: "120ms" }}>
      <DriftRings width={120} />
      <h2 className="m-0 font-serif text-[27px] font-normal leading-none">Connect to see your escrows</h2>
      <p className="m-0 text-sm text-muted">Everything you pay, receive or arbitrate.</p>
      <button
        type="button"
        onClick={() => openConnect("escrows")}
        className="lift-app inline-flex min-h-[52px] items-center gap-2.5 rounded-pill border-0 bg-lime px-[26px] text-[15px] font-extrabold text-ink"
      >
        <WalletIcon />
        Connect wallet
      </button>
      <p className="m-0 text-[13px] text-muted">
        Or{" "}
        <Link href="/find" className="font-bold underline-offset-4">
          find an escrow by its number
        </Link>
      </p>
    </section>
  );
}

/** Every escrow the wallet is part of, filtered: Open, Needs action, Paying, Receiving, Closed. */
export function EscrowsScreen() {
  const { address, ready } = useWallet();
  const mine = useMyEscrows(address);
  const [filter, setFilter] = useState<Filter>("open");
  const [showHidden, setShowHidden] = useState(false);
  const head = <PageHead title="Escrows" action={<NewButton />} />;

  if (ready && !address) {
    return (
      <main id="main" className="flex flex-col gap-[22px]">
        {head}
        <ConnectCard />
      </main>
    );
  }
  if (address && mine.error && !mine.loaded) {
    return (
      <main id="main" className="flex flex-col gap-[22px]">
        {head}
        <ReadError reason={toSisonkeError(mine.error).body} onRetry={mine.refetch} />
      </main>
    );
  }

  const loaded = !!address && mine.loaded;
  const rows = mine.visible.filter((m) => matches(filter, m, mine.clock));
  const extra = showHidden ? mine.collapsed.filter((m) => matches(filter, m, mine.clock)) : [];
  const userHidden = mine.collapsed.length - mine.spam;
  const tokenOk = (token: string) => !!mine.token && token === mine.token;

  return (
    <main id="main" className="flex flex-col gap-[22px]">
      {head}
      <section className="rise rounded-card border border-line bg-card pt-3.5 pb-1.5" style={{ animationDelay: "100ms" }}>
        <div role="group" aria-label="Filter escrows" className="flex flex-wrap gap-1.5 px-3.5 pb-3.5">
          {loaded
            ? FILTERS.map((f) => {
                const on = f.value === filter;
                const count = mine.visible.filter((m) => matches(f.value, m, mine.clock)).length;
                return (
                  <button
                    key={f.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(f.value)}
                    className={cn("inline-flex min-h-10 items-center gap-2 rounded-pill border-0 px-3.5 text-sm font-bold", on ? "bg-ink text-on-ink" : "bg-sand text-ink")}
                  >
                    {f.label}
                    <span className="tabular text-xs opacity-70">{count}</span>
                  </button>
                );
              })
            : FILTERS.map((f) => <Ph key={f.value} moving className="h-10 w-24 rounded-pill" />)}
        </div>
        <TableHead />
        {!loaded ? (
          <>
            <span role="status" className="sr-only">
              Loading your escrows from Stellar…
            </span>
            <PlaceholderRows moving count={6} />
          </>
        ) : rows.length + extra.length ? (
          <ul aria-live="polite" className="m-0 list-none p-0">
            {[...rows, ...extra].map((m) => (
              <EscrowLine
                key={m.view.escrow.id.toString()}
                mine={m}
                need={needsAction(m, mine.clock)}
                tokenOk={tokenOk(m.view.escrow.token)}
                muted={mine.collapsed.includes(m)}
              />
            ))}
          </ul>
        ) : (
          <p className="m-0 px-[18px] py-9 text-center text-sm text-muted">
            {mine.visible.length === 0 ? "No escrows yet. Start one, or ask the person paying you for its link." : "Nothing here."}
          </p>
        )}
      </section>

      {loaded && mine.collapsed.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile bg-sand px-[22px] py-3.5 text-sm">
          <span>
            {mine.spam > 0 && (
              <>
                {mine.spam} hidden: tiny, short-lived, or taken back by their sender.
                {userHidden > 0 && " "}
              </>
            )}
            {userHidden > 0 && <>{userHidden} hidden by you.</>}
          </span>
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((s) => !s)}
            className="min-h-11 rounded-pill border-[1.5px] border-ink bg-transparent px-4 text-sm font-bold"
          >
            {showHidden ? "Hide them" : "Show them"}
          </button>
        </div>
      )}
      {loaded && mine.hasOlder && (
        <button type="button" onClick={mine.older} className="lift-app min-h-12 self-center rounded-pill border-[1.5px] border-ink bg-card px-6 text-sm font-bold">
          {mine.fetching ? "Loading…" : "Show older escrows"}
        </button>
      )}
    </main>
  );
}
