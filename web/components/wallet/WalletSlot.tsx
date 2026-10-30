"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { addressLink } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { useReadiness } from "@/lib/hooks/queries";
import { balanceStroops, formatUsdc } from "@/lib/sisonke/amount";
import { CaretDown, CheckIcon, CopyIcon, DropIcon, OpenIcon, PowerIcon, WalletIcon } from "@/components/ui/icons";
import { WalletLogo } from "./WalletLogo";
import { useWallet } from "./WalletProvider";

/** Two decimals, rounded down (bigint stroops: 3.5999998 → "3.59"). */
const cents = (stroops: bigint) => formatUsdc((stroops / 100_000n) * 100_000n);

/** USDC and XLM as "1,240.00" for the chip and the ticket; null while unknown. */
function useBalances(address: string | null) {
  const r = useReadiness(address).data;
  if (!r) return { usdc: null, xlm: null };
  return {
    usdc: r.usdc ? cents(balanceStroops(r.usdc.balance)) : "0.00",
    xlm: r.xlm ? cents(balanceStroops(r.xlm)) : "0.00",
  };
}

/** The ticket: logo, name, address + copy, balances, links, disconnect. */
function Ticket({ onClose }: { onClose: () => void }) {
  const { address, walletName, walletIcon, onTestnet, disconnect } = useWallet();
  const b = useBalances(address);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!address) return null;
  const explorer = addressLink(address);
  const row = "flex min-h-11 items-center gap-2.5 text-sm font-semibold text-ink no-underline";
  return (
    <div
      role="dialog"
      aria-label="Your wallet"
      className="popin absolute top-[calc(100%+10px)] right-0 z-50 flex w-[min(340px,calc(100vw-32px))] flex-col rounded-[22px] border-[1.5px] border-ink bg-ground p-4 text-ink shadow-ticket"
    >
      <div className="flex items-center gap-3 pb-3">
        {walletIcon && <WalletLogo src={walletIcon} size={40} />}
        <div className="flex min-w-0 flex-auto flex-col gap-0.5">
          <span className="flex items-center gap-[7px] text-sm font-bold">
            {walletName ?? "Wallet"}
            <span aria-hidden="true" className={cn("size-[7px] rounded-pill", onTestnet === false ? "bg-error" : "pulse bg-violet")} />
          </span>
          <span className="font-mono text-[13px] text-muted" title={address}>
            {shortAddress(address)}
          </span>
        </div>
        <button
          type="button"
          aria-label={copied ? "Address copied" : "Copy address"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(address);
            } catch {
              /* clipboard blocked: the tick still confirms the click */
            }
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1600);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-icon border-[1.5px] border-line bg-card text-ink"
        >
          {copied ? <CheckIcon size={18} className="popin text-violet" /> : <CopyIcon />}
        </button>
      </div>
      <div aria-hidden="true" className="-mx-[17px] flex items-center">
        <span className="h-5 w-[11px] shrink-0 rounded-r-pill bg-ink" />
        <span className="mx-1.5 flex-auto border-t-2 border-dashed border-ticket-line" />
        <span className="h-5 w-[11px] shrink-0 rounded-l-pill bg-ink" />
      </div>
      {onTestnet === false && (
        <p role="alert" className="m-0 pt-3 text-[13px] font-semibold text-error">
          Wrong network. Switch your wallet to Testnet.
        </p>
      )}
      <dl className="m-0 grid grid-cols-2 gap-2.5 py-3">
        <div className="flex flex-col gap-[3px]">
          <dt className="text-xs font-semibold text-muted">USDC</dt>
          <dd className="display tabular m-0 text-[22px]">{b.usdc ?? "…"}</dd>
        </div>
        <div className="flex flex-col gap-[3px]">
          <dt className="text-xs font-semibold text-muted">XLM for fees</dt>
          <dd className="display tabular m-0 text-[22px]">{b.xlm ?? "…"}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-0.5 border-t border-line pt-2">
        {explorer && (
          <a href={explorer} target="_blank" rel="noopener noreferrer" className={row}>
            <OpenIcon />
            View on Stellar Expert
          </a>
        )}
        <Link href="/setup" onClick={onClose} className={row}>
          <DropIcon size={18} />
          Top up test money
        </Link>
        <button
          type="button"
          onClick={() => {
            onClose();
            void disconnect();
          }}
          className="flex min-h-11 items-center gap-2.5 border-0 bg-transparent p-0 text-sm font-bold text-error"
        >
          <PowerIcon />
          Disconnect
        </button>
      </div>
    </div>
  );
}

/**
 * The wallet slot at the far right of the top row: lime "Connect wallet", or
 * the dark chip (logo, name, address, USDC) that opens the ticket.
 */
export function WalletSlot({ compact = false }: { compact?: boolean }) {
  const { address, walletName, walletIcon, ready, openConnect, onTestnet } = useWallet();
  const b = useBalances(address);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!address) {
    return (
      <button
        type="button"
        onClick={() => ready && openConnect()}
        aria-disabled={!ready || undefined}
        className={cn(
          "glow-sm inline-flex shrink-0 items-center whitespace-nowrap rounded-pill border-0 bg-lime font-extrabold text-ink",
          compact ? "min-h-11 gap-2 px-4 text-sm" : "lift-app min-h-[50px] gap-2.5 pr-6 pl-5 text-sm",
        )}
      >
        <WalletIcon size={compact ? 18 : 20} />
        {compact ? "Connect" : "Connect wallet"}
      </button>
    );
  }

  const label = `Wallet account: ${walletName ?? "wallet"} ${shortAddress(address)}`;
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "inline-flex items-center rounded-pill border-0 bg-ink text-on-ink",
          compact ? "min-h-11 gap-2 pr-3 pl-1.5" : "min-h-[50px] gap-2.5 pr-4 pl-1.5",
        )}
      >
        {walletIcon ? (
          <WalletLogo src={walletIcon} size={compact ? 32 : 38} round />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-pill bg-lime text-ink">
            <WalletIcon size={18} />
          </span>
        )}
        {compact ? (
          <span className="font-mono text-[13px]">{shortAddress(address)}</span>
        ) : (
          <>
            <span className="flex flex-col items-start gap-px leading-[1.1]">
              <span className="text-[13px] font-bold">{walletName ?? "Wallet"}</span>
              <span className="font-mono text-xs text-on-ink-muted">{shortAddress(address)}</span>
            </span>
            <span className="ml-1.5 inline-flex items-baseline gap-1 whitespace-nowrap border-l border-ink-line pl-3">
              {onTestnet === false ? (
                <span className="text-xs font-bold text-tomato">Wrong network</span>
              ) : (
                <>
                  <span className="display tabular text-base">{b.usdc ?? "…"}</span>
                  <span className="text-[11px] font-bold text-on-ink-muted">USDC</span>
                </>
              )}
            </span>
            <CaretDown className="text-on-ink-muted" />
          </>
        )}
      </button>
      {open && <Ticket onClose={() => setOpen(false)} />}
    </div>
  );
}
