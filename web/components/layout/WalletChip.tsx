"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { addressLink } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { useReadiness } from "@/lib/hooks/queries";
import { balanceStroops, formatUsdc } from "@/lib/sisonke/amount";
import { CheckIcon, ChevronDown } from "@/components/ui/icons";
import { CopyButton } from "@/components/ui/CopyButton";
import { useWallet } from "@/components/wallet/WalletProvider";

/** The menu body: address, explorer, network, balances, switch, disconnect. */
export function WalletMenuBody({ onClose }: { onClose?: () => void }) {
  const { address, onTestnet, openConnect, disconnect } = useWallet();
  const readiness = useReadiness(address);
  if (!address) return null;
  const r = readiness.data;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-1.5">
        <span className="text-xs font-bold text-muted">Connected address</span>
        <span className="break-all font-mono text-[13px] leading-snug">{address}</span>
        <div className="flex flex-wrap items-center gap-x-4">
          <CopyButton value={address} ariaLabel="Copy my address" />
          {addressLink(address) && (
            <a href={addressLink(address)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-bold text-violet">
            View on Stellar Expert
          </a>
          )}
        </div>
      </div>
      <div className="mx-1.5 border-t border-sand px-2 py-2.5 text-sm">
        {onTestnet === false ? (
          <span className="font-semibold text-error">Wrong network: switch your wallet to Testnet</span>
        ) : (
          <span className="inline-flex items-center gap-2 font-semibold">
            <CheckIcon size={14} /> Stellar Testnet
          </span>
        )}
      </div>
      <dl className="mx-1.5 m-0 grid grid-cols-2 gap-2 border-t border-sand px-2 py-2.5 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">XLM</dt>
          <dd className="m-0 font-bold tabular">{r ? (r.xlm ? formatUsdc(balanceStroops(r.xlm)) : "0.00") : "…"}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">USDC</dt>
          <dd className="m-0 font-bold tabular">{r ? (r.usdc ? formatUsdc(balanceStroops(r.usdc.balance)) : "No trustline") : "…"}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => {
          onClose?.();
          openConnect();
        }}
        className="mx-0.5 min-h-[46px] border-0 border-t border-sand bg-transparent px-3 text-left text-sm font-bold"
      >
        Switch wallet
      </button>
      <button
        type="button"
        onClick={() => {
          onClose?.();
          void disconnect();
        }}
        className="mx-0.5 min-h-[46px] border-0 border-t border-sand bg-transparent px-3 text-left text-sm font-bold text-error"
      >
        Disconnect
      </button>
    </div>
  );
}

/** Ink pill: network dot, wallet name, short address, chevron; opens the menu. */
export function WalletChip() {
  const { address, walletName, onTestnet } = useWallet();
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

  if (!address) return null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Wallet account, ${walletName ?? "wallet"} ${shortAddress(address)}`}
        className="inline-flex min-h-10 items-center gap-2 rounded-pill border-0 bg-ink py-0 pr-3 pl-3.5 text-[13px] text-on-ink"
      >
        <span aria-hidden="true" className={cn("size-2 rounded-pill", onTestnet === false ? "bg-error" : "bg-lime")} />
        {walletName && <span className="font-semibold">{walletName}</span>}
        <span className="font-mono">{shortAddress(address)}</span>
        <ChevronDown color="var(--color-on-ink)" />
      </button>
      {open && (
        <div aria-label="Wallet menu" className="slidein absolute top-12 right-0 z-30 w-[300px] rounded-menu border border-line bg-card p-1.5 shadow-menu">
          <WalletMenuBody onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
