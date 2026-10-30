"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { padId } from "@/lib/format";
import { useInfo } from "@/lib/hooks/queries";
import { useMyEscrows } from "@/lib/hooks/useMyEscrows";
import { needsAction } from "@/lib/sisonke/overview";
import { ContractNotices } from "@/components/layout/ContractNotices";
import { DropIcon, FindIcon, HomeIcon, ListIcon, PlusBold } from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/Logo";
import { WalletSlot } from "@/components/wallet/WalletSlot";
import { useWallet } from "@/components/wallet/WalletProvider";
import { HOME, NAV, TOOLS, activeOf, crumbOf, type NavHref } from "./nav";

const ICON: Record<NavHref, (p: { size?: number }) => ReactNode> = {
  "/overview": HomeIcon,
  "/escrows": ListIcon,
  "/find": FindIcon,
  "/setup": DropIcon,
  "/new": PlusBold,
};

/** usePathname suspends on dynamic routes under Cache Components: render without it first. */
function WithPath({ children }: { children: (path: string | null) => ReactNode }) {
  return <Suspense fallback={children(null)}><PathReader>{children}</PathReader></Suspense>;
}
function PathReader({ children }: { children: (path: string | null) => ReactNode }) {
  return <>{children(usePathname())}</>;
}

/** The connected wallet's "needs action" count, for the Escrows badge. */
function useNeedCount(): number {
  const { address } = useWallet();
  const mine = useMyEscrows(address);
  if (!address || !mine.loaded) return 0;
  return mine.visible.filter((m) => needsAction(m, mine.clock)).length;
}

/** The white pill logo, as in the landing header, with a Testnet tag. */
function LogoPill() {
  return (
    <Link href={HOME} aria-label="Sisonke app home" className="flex min-h-[52px] items-center gap-2.5 rounded-pill bg-card pr-2.5 pl-3 text-ink no-underline hover:text-ink">
      <LogoMark size={30} />
      <span className="flex-auto text-2xl font-bold tracking-[-0.03em]">sisonke</span>
      <span className="inline-flex min-h-[26px] items-center gap-1.5 rounded-pill bg-sand px-2.5 text-xs font-bold text-ink">
        <span aria-hidden="true" className="size-1.5 rounded-pill bg-violet" />
        Testnet
      </span>
    </Link>
  );
}

function SideLink({ href, label, on, badge }: { href: NavHref; label: string; on: boolean; badge?: number }) {
  const Icon = ICON[href];
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "navi flex min-h-[46px] items-center gap-3 rounded-field px-3 text-sm no-underline",
        on ? "bg-ground font-bold text-ink hover:bg-ground hover:text-ink" : "font-semibold text-on-ink hover:text-on-ink",
      )}
    >
      <Icon size={20} />
      <span className="flex-auto">{label}</span>
      {!!badge && (
        <span className="inline-flex h-[22px] min-w-6 items-center justify-center rounded-pill bg-lime px-[7px] text-xs font-extrabold text-ink">
          {badge}
          <span className="sr-only"> need action</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ path }: { path: string | null }) {
  const active = activeOf(path);
  const need = useNeedCount();
  return (
    <aside
      aria-label="Sisonke menu"
      className="rise sticky top-3 flex h-[calc(100dvh-24px)] w-[264px] shrink-0 flex-col gap-[22px] overflow-y-auto rounded-shell bg-ink px-4 pt-5 pb-4 text-on-ink max-[881px]:hidden"
    >
      <LogoPill />
      <Link
        href="/new"
        aria-current={active === "/new" ? "page" : undefined}
        className={cn(
          "display lift-app flex min-h-[52px] items-center justify-center gap-2.5 rounded-pill bg-lime text-lg text-ink no-underline hover:text-ink",
          active === "/new" && "shadow-cta-ring",
        )}
      >
        <PlusBold size={18} />
        New escrow
      </Link>
      <nav aria-label="App" className="flex flex-col gap-1">
        {NAV.map((n) => (
          <SideLink key={n.href} href={n.href} label={n.label} on={active === n.href} badge={n.href === "/escrows" ? need : undefined} />
        ))}
      </nav>
      <nav aria-label="Testnet tools" className="flex flex-col gap-1">
        <span className="px-3 pb-1.5 text-[11px] font-bold tracking-[0.1em] text-on-ink-faint uppercase">Testnet</span>
        {TOOLS.map((n) => (
          <SideLink key={n.href} href={n.href} label={n.label} on={active === n.href} />
        ))}
      </nav>
      <div className="flex-auto" />
      <div className="flex flex-col gap-1 rounded-menu border border-ink-line bg-ink-well px-4 py-3.5">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span aria-hidden="true" className="size-2 rounded-pill bg-lime" />
          Practice mode
        </span>
        <span className="text-[13px] text-on-ink-muted">Test funds only</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2">
        <Link href="/rules" className="inline-flex min-h-9 items-center text-[13px] font-semibold text-on-ink-muted underline-offset-4 hover:text-lime">
          Rules and proof
        </Link>
        <Link href="/" className="inline-flex min-h-9 items-center text-[13px] font-semibold text-on-ink-muted underline-offset-4 hover:text-lime">
          Website
        </Link>
      </div>
    </aside>
  );
}

/** "Search escrows" with the newest real id as the hint. */
function SearchPill() {
  const count = useInfo().data?.info?.escrowCount ?? null;
  return (
    <Link
      href="/find"
      aria-label="Search escrows"
      className="flex min-h-12 min-w-0 flex-[0_1_280px] items-center gap-2.5 rounded-pill border-[1.5px] border-line bg-card pr-2 pl-4 text-sm font-semibold text-muted no-underline hover:text-ink"
    >
      <FindIcon size={16} />
      <span className="min-w-0 flex-auto truncate">Search escrows</span>
      {count !== null && count > 0n && <span aria-hidden="true" className="shrink-0 rounded-pill bg-sand px-2.5 py-1 font-mono text-xs text-ink">{padId(count)}</span>}
    </Link>
  );
}

/** Desktop: one row, breadcrumb left, search and wallet at the far right. Never wraps. */
function TopRow({ path }: { path: string | null }) {
  const crumb = crumbOf(path);
  return (
    <div className="rise relative z-30 flex flex-nowrap items-center justify-between gap-5 max-[881px]:hidden" style={{ animationDelay: "60ms" }}>
      <nav aria-label="Breadcrumb" className="flex flex-none items-center gap-2 whitespace-nowrap text-sm font-semibold text-muted">
        <Link href={HOME} className="text-muted no-underline">
          App
        </Link>
        {crumb && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-ink">
              {crumb}
            </span>
          </>
        )}
      </nav>
      <div className="flex min-w-0 flex-auto flex-nowrap items-center justify-end gap-3">
        {path !== "/find" && <SearchPill />}
        <WalletSlot />
      </div>
    </div>
  );
}

/** Phone: white pill bar, logo left, Connect or the wallet chip right. */
function PhoneBar() {
  return (
    <div className="relative z-30 flex items-center justify-between gap-2.5 rounded-pill border border-line bg-card py-1.5 pr-1.5 pl-3.5 min-[881px]:hidden">
      <Link href={HOME} aria-label="Sisonke app home" className="flex items-center gap-2 text-ink no-underline hover:text-ink">
        <LogoMark size={24} />
        <span className="text-xl font-bold tracking-[-0.03em]">sisonke</span>
      </Link>
      <WalletSlot compact />
    </div>
  );
}

/** Phone: the floating dark dock with the lime + in the middle. */
function Dock({ path }: { path: string | null }) {
  const active = activeOf(path);
  const item = (href: NavHref, label: string) => {
    const Icon = ICON[href];
    const on = active === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={on ? "page" : undefined}
        className={cn("flex min-h-[52px] flex-col items-center justify-center gap-1 text-[11px] no-underline", on ? "font-bold text-lime hover:text-lime" : "font-semibold text-on-ink-muted hover:text-on-ink")}
      >
        <Icon size={22} />
        <span className={on ? "text-on-ink" : "text-on-ink-muted"}>{label}</span>
      </Link>
    );
  };
  return (
    <nav
      aria-label="App"
      className="fixed right-3 bottom-3 left-3 z-40 grid grid-cols-5 items-end rounded-[26px] bg-ink px-1 py-2 shadow-dock min-[881px]:hidden"
    >
      {item("/overview", "Overview")}
      {item("/escrows", "Escrows")}
      <Link
        href="/new"
        aria-label="New escrow"
        aria-current={active === "/new" ? "page" : undefined}
        className="-mt-[30px] flex size-[62px] items-center justify-center justify-self-center rounded-pill border-[5px] border-ground bg-lime text-ink no-underline hover:text-ink"
      >
        <PlusBold size={24} />
      </Link>
      {item("/find", "Find")}
      {item("/setup", "Funds")}
    </nav>
  );
}

/** Every app route: dark sidebar (desktop) or top bar + dock (phone), then the page. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-start gap-3 p-3 max-[881px]:block">
      <WithPath>{(path) => <Sidebar path={path} />}</WithPath>
      <div className="flex min-w-0 flex-auto flex-col gap-[22px] px-4 pt-2.5 pb-12 max-[881px]:px-0 max-[881px]:pt-1 max-[881px]:pb-[124px]">
        <PhoneBar />
        <WithPath>{(path) => <TopRow path={path} />}</WithPath>
        <ContractNotices bare>{children}</ContractNotices>
      </div>
      <WithPath>{(path) => <Dock path={path} />}</WithPath>
    </div>
  );
}
