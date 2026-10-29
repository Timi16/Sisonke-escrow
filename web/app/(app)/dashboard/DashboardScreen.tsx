"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useInfo, useParty } from "@/lib/hooks/queries";
import { readHidden, writeHidden } from "@/lib/sisonke/hidden";
import { likelySpam } from "@/lib/sisonke/spam";
import { rowHint, type Tab } from "@/lib/sisonke/status";
import { isFinal, isLocked, type EscrowView } from "@/lib/sisonke/types";
import { toSisonkeError } from "@/lib/sisonke/errors";
import { EscrowRow } from "@/components/escrow/EscrowRow";
import { LogoMark } from "@/components/ui/Logo";
import { PlusIcon } from "@/components/ui/icons";
import { ReadError, Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useWallet } from "@/components/wallet/WalletProvider";

type Filter = "all" | "created" | "funded" | "closed";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "created", label: "Awaiting deposit" },
  { value: "funded", label: "Funded" },
  { value: "closed", label: "Closed" },
];

const matches = (f: Filter, v: EscrowView) =>
  f === "all" ||
  (f === "created" && v.escrow.status === "Created") ||
  (f === "funded" && isLocked(v.escrow.status)) ||
  (f === "closed" && isFinal(v.escrow.status));

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-x-10 gap-y-5" style={{ animationDelay: "60ms" }}>
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 font-serif text-[clamp(44px,5.4vw,76px)] font-normal leading-[0.98] tracking-[-0.02em]">Your escrows</h1>
        <p className="m-0 max-w-[34em] text-[17px] leading-[1.55] text-muted">
          Everything you&apos;re paying for and getting paid for, in one place.
        </p>
      </div>
      <Link
        href="/new"
        className="display lift inline-flex min-h-[58px] items-center gap-2.5 rounded-pill bg-lime px-7 text-[22px] text-ink no-underline shadow-cta-ring hover:text-ink"
      >
        <PlusIcon size={18} />
        New escrow
      </Link>
    </div>
  );
}

function ConnectCard() {
  const { openConnect } = useWallet();
  return (
    <section className="rise flex max-w-[560px] flex-col gap-4 rounded-card border-[1.5px] border-ink bg-card p-[26px] shadow-action" style={{ animationDelay: "120ms" }}>
      <h2 className="m-0 font-serif text-[34px] font-normal leading-none">Connect to see your escrows</h2>
      <p className="m-0 text-[15px] leading-[1.55] text-muted">
        Your list comes straight from the contract on Stellar: every escrow you pay, receive or arbitrate. Sisonke never sees your keys.
      </p>
      <button type="button" onClick={openConnect} className="display lift min-h-[58px] w-full rounded-pill border-[1.5px] border-ink bg-lime text-[21px] text-ink">
        Connect wallet
      </button>
      <p className="m-0 text-sm text-muted">
        Or{" "}
        <Link href="/find" className="font-bold underline-offset-4">
          find an escrow by ID
        </Link>
      </p>
    </section>
  );
}

function Empty({ title, body, cta }: { title: string; body: string; cta?: boolean }) {
  return (
    <div className="rise flex flex-col items-center gap-2.5 rounded-[24px] bg-sand px-6 py-12 text-center">
      <LogoMark size={48} stroke={2} />
      <span className="text-lg font-bold">{title}</span>
      <span className="text-[15px] text-muted">{body}</span>
      {cta && (
        <Link href="/new" className="display lift mt-2 inline-flex min-h-[54px] items-center rounded-pill border-[1.5px] border-ink bg-lime px-[26px] text-xl text-ink no-underline hover:text-ink">
          Start an escrow
        </Link>
      )}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-label="Loading escrows" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex flex-wrap items-center gap-6 rounded-tile border-[1.5px] border-line bg-card px-[22px] py-5">
          <div className="flex flex-[1_1_260px] flex-col gap-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24 rounded-pill" />
        </li>
      ))}
    </ul>
  );
}

export function DashboardScreen() {
  const { address, ready } = useWallet();
  const info = useInfo();
  const [chosenTab, setTab] = useState<Tab>("paying");
  const [filter, setFilter] = useState<Filter>("all");
  const [windows, setWindows] = useState<Record<Tab, number>>({ paying: 1, receiving: 1, arbiter: 1 });
  // Hidden ids are a per-address view preference in localStorage.
  // `changed` keeps this page view right even when storage is blocked.
  const [changed, setChanged] = useState<{ address: string; ids: Set<string> } | null>(null);
  const [showHiddenFor, setShowHiddenFor] = useState<string | null>(null);
  const stored = useMemo(() => (address ? readHidden(address) : new Set<string>()), [address]);
  const hidden = changed && changed.address === address ? changed.ids : stored;
  const showHidden = !!address && showHiddenFor === address;
  const setShowHidden = (f: (v: boolean) => boolean) => setShowHiddenFor(f(showHidden) ? address : null);

  const paying = useParty(address, "Payer", windows.paying);
  const receiving = useParty(address, "Recipient", windows.receiving);
  const arbiter = useParty(address, "Arbiter", windows.arbiter);
  const queries = { paying, receiving, arbiter };
  const arbiterCount = arbiter.data?.count ?? 0;
  // The arbiter tab exists only while the count is above 0.
  const tab: Tab = chosenTab === "arbiter" && arbiter.data && arbiterCount === 0 ? "paying" : chosenTab;
  const q = queries[tab];

  const token = info.data?.info?.token ?? null;
  const upgradePending = !!info.data?.info?.pendingUpgrade;

  const toggleHide = (id: string) => {
    if (!address) return;
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeHidden(address, next);
    setChanged({ address, ids: next });
  };

  const sorted = useMemo(() => {
    const views = q.data?.views ?? [];
    const visible: EscrowView[] = [];
    const collapsed: EscrowView[] = [];
    let spam = 0;
    for (const v of views) {
      const id = v.escrow.id.toString();
      const isSpam = !!address && likelySpam(v.escrow, address, tab);
      if (hidden.has(id) || isSpam) {
        collapsed.push(v);
        if (isSpam && !hidden.has(id)) spam++;
      } else visible.push(v);
    }
    return { visible, collapsed, spam, all: views };
  }, [q.data, hidden, address, tab]);

  if (!ready) {
    return (
      <Main>
        <Header />
        <RowsSkeleton />
      </Main>
    );
  }
  if (!address) {
    return (
      <Main>
        <Header />
        <ConnectCard />
      </Main>
    );
  }

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "paying", label: "I'm paying", count: paying.data?.count },
    { value: "receiving", label: "I'm receiving", count: receiving.data?.count },
    ...(arbiterCount > 0 ? [{ value: "arbiter" as Tab, label: "I'm the arbiter", count: arbiterCount }] : []),
  ];

  // Stats count the current tab, without the rows a person never signed on and hid.
  const base = sorted.visible;
  const needsYou = base.filter((v) => rowHint(v, tab).needsYou).length;
  const locked = base.filter((v) => isLocked(v.escrow.status)).length;
  const closed = base.filter((v) => isFinal(v.escrow.status)).length;
  const rows = sorted.visible.filter((v) => matches(filter, v));
  const extra = showHidden ? sorted.collapsed.filter((v) => matches(filter, v)) : [];
  const brandNew = paying.data?.count === 0 && receiving.data?.count === 0 && arbiterCount === 0;
  const userHidden = sorted.collapsed.length - sorted.spam;

  return (
    <Main>
      <Header />
      <div className="rise flex flex-wrap items-center justify-between gap-4" style={{ animationDelay: "120ms" }}>
        <Tabs tabs={tabs} value={tab} onChange={(t) => setTab(t)} label="Escrow side" idPrefix="side" controls="escrow-list" />
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "min-h-10 rounded-pill border-[1.5px] px-4 text-sm font-semibold transition-colors",
                filter === f.value ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-transparent text-ink hover:border-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rise grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3" style={{ animationDelay: "160ms" }}>
        <div className="flex flex-col gap-1.5 rounded-tile bg-ink px-6 py-[22px] text-on-ink">
          <span className="text-sm text-on-ink-muted">Need your attention</span>
          <span className="display tabular text-[52px] text-lime">{q.data ? needsYou : "–"}</span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-tile border border-line bg-card px-6 py-[22px]">
          <span className="text-sm text-muted">Locked right now</span>
          <span className="display tabular text-[52px]">{q.data ? locked : "–"}</span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-tile bg-sand px-6 py-[22px]">
          <span className="text-sm text-muted">Closed for good</span>
          <span className="display tabular text-[52px]">{q.data ? closed : "–"}</span>
        </div>
      </div>

      <div id="escrow-list" role="tabpanel" aria-labelledby={`side-${tab}`} className="flex flex-col gap-2.5">
        {q.isError && !q.data ? (
          <ReadError reason={toSisonkeError(q.error).body} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <RowsSkeleton />
        ) : brandNew ? (
          <Empty title="No escrows yet" body="Start one, or ask the person paying you to send you its link." cta />
        ) : (
          <>
            {rows.length + extra.length > 0 ? (
              <ul aria-live="polite" className="m-0 flex list-none flex-col gap-2.5 p-0">
                {[...rows, ...extra].map((v, i) => (
                  <EscrowRow
                    key={v.escrow.id.toString()}
                    view={v}
                    tab={tab}
                    tokenOk={!!token && v.escrow.token === token}
                    upgradePending={upgradePending}
                    hidden={hidden.has(v.escrow.id.toString())}
                    onToggleHide={() => toggleHide(v.escrow.id.toString())}
                    delay={Math.min(i, 8) * 70}
                  />
                ))}
              </ul>
            ) : (
              <Empty title="Nothing here yet" body="Try another filter, or start a new escrow." />
            )}
            {sorted.collapsed.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile bg-sand px-[22px] py-4 text-sm">
                <span>
                  {sorted.spam > 0 && (
                    <>
                      {sorted.spam} hidden: tiny, short-lived, or taken back by their sender.
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
            {q.data.hasOlder && (
              <button
                type="button"
                onClick={() => setWindows((w) => ({ ...w, [tab]: w[tab] + 1 }))}
                className="lift min-h-12 self-center rounded-pill border-[1.5px] border-ink bg-card px-6 text-[15px] font-bold"
              >
                {q.isFetching ? "Loading…" : "Show older escrows"}
              </button>
            )}
          </>
        )}
      </div>
    </Main>
  );
}

function Main({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 pt-12 pb-24 min-[720px]:px-6">
      {children}
    </main>
  );
}
