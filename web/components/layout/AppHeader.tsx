"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { Logo } from "@/components/ui/Logo";
import { MenuIcon, SearchIcon } from "@/components/ui/icons";
import { useWallet } from "@/components/wallet/WalletProvider";
import { WalletChip, WalletMenuBody } from "./WalletChip";

const NAV = [
  { href: "/dashboard", label: "My escrows" },
  { href: "/new", label: "New escrow" },
  { href: "/rules", label: "Rules" },
];

function NavLinks({ current, column = false, onPick }: { current: string | null; column?: boolean; onPick?: () => void }) {
  return (
    <nav aria-label="App" className={cn("flex gap-1", column ? "flex-col" : "flex-wrap")}>
      {NAV.map((n) => {
        const on = current !== null && (current === n.href || current.startsWith(`${n.href}/`));
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onPick}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-pill px-3.5 text-[15px] no-underline",
              on ? "bg-sand font-bold" : "font-semibold",
              column && "min-h-11",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** usePathname needs a Suspense boundary on routes with dynamic params. */
function CurrentNav(props: { column?: boolean; onPick?: () => void }) {
  return <NavLinks current={usePathname()} {...props} />;
}

function Nav(props: { column?: boolean; onPick?: () => void }) {
  return (
    <Suspense fallback={<NavLinks current={null} {...props} />}>
      <CurrentNav {...props} />
    </Suspense>
  );
}

export function TestnetBadge() {
  return (
    <span className="inline-flex min-h-[30px] items-center gap-1.5 rounded-pill bg-sand px-3 text-[13px] font-semibold">
      <span aria-hidden="true" className="size-[7px] rounded-pill bg-violet" />
      Testnet
    </span>
  );
}

function FindLink({ onPick }: { onPick?: () => void }) {
  return (
    <Link
      href="/find"
      onClick={onPick}
      className="inline-flex min-h-10 items-center gap-2 rounded-pill border-[1.5px] border-line bg-ground px-3.5 text-sm font-semibold text-ink no-underline"
    >
      <SearchIcon />
      Find an escrow
    </Link>
  );
}

function ConnectButton({ onPick }: { onPick?: () => void }) {
  const { openConnect, ready } = useWallet();
  return (
    <button
      type="button"
      onClick={() => {
        onPick?.();
        openConnect();
      }}
      aria-disabled={!ready || undefined}
      className="lift min-h-10 rounded-pill border-[1.5px] border-ink bg-lime px-4 text-sm font-bold text-ink"
    >
      Connect wallet
    </button>
  );
}

/** Phone header: logo plus one ink pill that opens a sheet with everything else. */
function PhoneHeader() {
  const { address, onTestnet } = useWallet();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="sticky top-0 z-20 bg-header-glass px-3.5 py-3 min-[720px]:hidden">
      <div className="flex items-center justify-between gap-2.5 rounded-pill border border-line bg-card py-1.5 pr-1.5 pl-3.5">
        <Logo markSize={24} textSize={20} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="phone-sheet"
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border-0 bg-ink px-3.5 text-[13px] font-semibold text-on-ink"
        >
          {address ? (
            <>
              <span aria-hidden="true" className={cn("size-2 rounded-pill", onTestnet === false ? "bg-error" : "bg-lime")} />
              <span className="font-mono">{shortAddress(address)}</span>
            </>
          ) : (
            <>
              <MenuIcon size={14} color="var(--color-on-ink)" />
              Menu
            </>
          )}
        </button>
      </div>
      {open && (
        <div id="phone-sheet" className="slidein mt-2 flex flex-col gap-3 rounded-menu border border-line bg-card p-3 shadow-menu">
          <Nav column onPick={() => setOpen(false)} />
          <div className="flex flex-wrap items-center gap-2 border-t border-sand pt-3">
            <FindLink onPick={() => setOpen(false)} />
            <TestnetBadge />
          </div>
          <div className="border-t border-sand pt-2">
            {address ? <WalletMenuBody onClose={() => setOpen(false)} /> : <ConnectButton onPick={() => setOpen(false)} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** The app's pill nav header (Escrow and Dashboard boards). */
export function AppHeader() {
  const { address } = useWallet();
  return (
    <header className="relative z-10">
      <PhoneHeader />
      <div className="rise mx-auto hidden max-w-[1240px] px-6 pt-[18px] min-[720px]:block">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-panel border border-line bg-card py-2 pr-2 pl-[18px]">
          <Logo />
          <Nav />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FindLink />
            <TestnetBadge />
            {address ? <WalletChip /> : <ConnectButton />}
          </div>
        </div>
      </div>
    </header>
  );
}
