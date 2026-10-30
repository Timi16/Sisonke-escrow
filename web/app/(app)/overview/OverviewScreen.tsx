"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatShort, padId } from "@/lib/format";
import { useMyEscrows } from "@/lib/hooks/useMyEscrows";
import { formatUsdc } from "@/lib/sisonke/amount";
import { toSisonkeError } from "@/lib/sisonke/errors";
import { needsAction, recentActivity, totals, type Activity } from "@/lib/sisonke/overview";
import { displayTitle } from "@/lib/sisonke/title";
import { EscrowLine, PlaceholderRows, TableHead } from "@/components/app/EscrowTable";
import { PageHead } from "@/components/app/PageHead";
import { Ph, ReadError } from "@/components/ui/Skeleton";
import { useWallet } from "@/components/wallet/WalletProvider";

type Phase = "idle" | "loading" | "ready";

function Tile({ label, ink = false, children }: { label: string; ink?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2.5 rounded-card px-5 py-[18px]", ink ? "bg-ink text-on-ink" : "border border-line bg-card")}>
      <span className={cn("text-[13px] font-semibold", ink ? "text-on-ink-muted" : "text-muted")}>{label}</span>
      {children}
    </div>
  );
}

function Figure({ value, usdc = false, lime = false }: { value: string; usdc?: boolean; lime?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("display tabular text-[28px]", lime && "text-lime")}>{value}</span>
      {usdc && <span className="text-xs font-bold text-muted">USDC</span>}
    </span>
  );
}

function Tiles({ phase, t }: { phase: Phase; t: ReturnType<typeof totals> | null }) {
  const ph = (w: string, ink = false) => <Ph moving={phase === "loading"} ink={ink} className="h-[30px]" style={{ width: w }} />;
  return (
    <section aria-label="Totals" className="rise grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3" style={{ animationDelay: "80ms" }}>
      <Tile label="Needs action" ink>
        {t ? <Figure value={String(t.need)} lime /> : ph("48px", true)}
      </Tile>
      <Tile label="You locked">{t ? <Figure value={formatUsdc(t.youLocked)} usdc /> : ph("64%")}</Tile>
      <Tile label="Locked for you">{t ? <Figure value={formatUsdc(t.lockedForYou)} usdc /> : ph("64%")}</Tile>
      <Tile label="Completed">{t ? <Figure value={String(t.completed)} /> : ph("48px")}</Tile>
    </section>
  );
}

function NeedsCard({ children, head }: { children: ReactNode; head?: ReactNode }) {
  return (
    <section aria-labelledby="need-h" className="rise min-w-0 flex-[999_1_460px] rounded-card border border-line bg-card pt-[18px] pb-1.5" style={{ animationDelay: "140ms" }}>
      <div className="flex items-center justify-between gap-3 px-[18px] pb-3.5">
        <h2 id="need-h" className="m-0 text-[15px] font-extrabold">
          Needs action
        </h2>
        {head}
      </div>
      <TableHead />
      {children}
    </section>
  );
}

function ActivityCard({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="act-h" className="rise flex min-w-0 flex-[1_1_280px] flex-col gap-1 rounded-card bg-ink p-[18px] text-on-ink" style={{ animationDelay: "200ms" }}>
      <h2 id="act-h" className="m-0 mb-2 text-[15px] font-extrabold">
        Activity
      </h2>
      {children}
    </section>
  );
}

function ActivityPlaceholders({ moving }: { moving: boolean }) {
  return (
    <div aria-hidden="true">
      {["70%", "55%", "64%", "48%"].map((w) => (
        <div key={w} className="flex items-center gap-3 border-t border-ghost-ink py-3">
          <span className="flex flex-auto flex-col gap-2">
            <Ph ink moving={moving} className="h-3" style={{ width: w }} />
            <Ph ink moving={moving} className="h-2.5 w-[40%]" />
          </span>
          <Ph ink moving={moving} className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const t = displayTitle(a.title);
  return (
    <Link href={`/escrow/${a.id}`} className="flex items-center gap-3 border-t border-ghost-ink py-2.5 text-on-ink no-underline hover:text-lime">
      <span className="flex min-w-0 flex-auto flex-col gap-0.5">
        <span className="truncate text-sm font-semibold" title={t.text}>
          {t.empty ? `Escrow ${padId(a.id)}` : t.text}
        </span>
        <span className="text-xs text-on-ink-faint">
          {a.what} · {formatShort(a.at)}
        </span>
      </span>
      <span className={cn("tabular shrink-0 font-mono text-sm", a.sign === "+" ? "text-lime" : a.sign === "-" ? "text-on-ink" : "text-on-ink-faint")}>
        {a.sign === "+" ? "+" : a.sign === "-" ? "−" : ""}
        {formatUsdc(a.amount)}
        <span className="sr-only"> USDC{a.sign === "+" ? " to you" : a.sign === "-" ? " from you" : ""}</span>
      </span>
    </Link>
  );
}

/** The app home: what needs you, the totals, and what moved lately. */
export function OverviewScreen() {
  const { address, ready, openConnect } = useWallet();
  const mine = useMyEscrows(address);
  const head = <PageHead title="Overview" />;

  if (ready && !address) {
    return (
      <main id="main" className="flex flex-col gap-[22px]">
        {head}
        <Tiles phase="idle" t={null} />
        <div className="relative">
          <div aria-hidden="true" className="flex flex-wrap items-start gap-3 opacity-80">
            <NeedsCard head={<Ph className="h-3 w-14" />}>
              <PlaceholderRows moving={false} />
            </NeedsCard>
            <ActivityCard>
              <ActivityPlaceholders moving={false} />
            </ActivityCard>
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-2 pt-[72px]">
            <div className="popin pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded-pill border-[1.5px] border-ink bg-card py-3 pr-3 pl-[22px] shadow-pill-pop max-[480px]:rounded-card max-[480px]:p-4 max-[480px]:text-center">
              <span className="text-sm font-bold">Connect your wallet to see your escrows</span>
              <button type="button" onClick={() => openConnect("escrows")} className="lift-app min-h-11 rounded-pill border-0 bg-lime px-5 text-sm font-extrabold text-ink">
                Connect wallet
              </button>
            </div>
          </div>
        </div>
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
  const t = loaded ? totals(mine.visible, mine.clock) : null;
  const need = loaded ? mine.visible.filter((m) => needsAction(m, mine.clock)) : [];
  const recent = loaded ? recentActivity(mine.visible) : [];

  return (
    <main id="main" className="flex flex-col gap-[22px]">
      {head}
      <Tiles phase={loaded ? "ready" : "loading"} t={t} />
      <div className="flex flex-wrap items-start gap-3">
        <NeedsCard
          head={
            <Link href="/escrows" className="text-sm font-bold underline-offset-4">
              View all
            </Link>
          }
        >
          {!loaded ? (
            <>
              <span role="status" className="sr-only">
                Loading your escrows from Stellar…
              </span>
              <PlaceholderRows moving />
            </>
          ) : need.length ? (
            <ul aria-live="polite" className="m-0 list-none p-0">
              {need.map((m) => (
                <EscrowLine key={m.view.escrow.id.toString()} mine={m} need tokenOk={!!mine.token && m.view.escrow.token === mine.token} />
              ))}
            </ul>
          ) : (
            <p className="m-0 px-[18px] py-9 text-center text-sm text-muted">
              Nothing needs you right now.{" "}
              {mine.visible.length === 0 && (
                <Link href="/new" className="font-bold text-ink underline-offset-4">
                  Start an escrow
                </Link>
              )}
            </p>
          )}
        </NeedsCard>
        <ActivityCard>
          {!loaded ? (
            <ActivityPlaceholders moving />
          ) : recent.length ? (
            recent.map((a) => <ActivityRow key={a.id} a={a} />)
          ) : (
            <p className="m-0 border-t border-ghost-ink py-3 text-sm text-on-ink-faint">Nothing has moved yet.</p>
          )}
        </ActivityCard>
      </div>
    </main>
  );
}
