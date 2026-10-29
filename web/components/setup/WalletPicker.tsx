"use client";
import { cn } from "@/lib/cn";
import { ChevronRight, ExternalIcon, Spinner } from "@/components/ui/icons";
import { useWallet } from "@/components/wallet/WalletProvider";

/** Wallet buttons with the board's initial tiles (shared by ConnectModal and /setup). */
export function WalletPicker({ className, variant = "list" }: { className?: string; variant?: "list" | "grid" }) {
  const { wallets, connecting, connectWith, connectError } = useWallet();
  const grid = variant === "grid";
  const tile = grid
    ? "min-h-16 gap-2.5 rounded-note border-[1.5px] border-line bg-ground px-3 py-2.5 text-[15px]"
    : "min-h-[60px] gap-3 rounded-note border-[1.5px] border-line bg-card px-3.5 py-2.5 text-base";
  return (
    <div className={cn(grid ? "grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5" : "flex flex-col gap-2", className)}>
      {wallets.map((w) => {
        const busy = connecting === w.id;
        const missing = w.available === false;
        if (missing) {
          return (
            <a
              key={w.id}
              href={w.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("flex items-center font-bold text-ink no-underline hover:text-ink", tile)}
            >
              <span aria-hidden="true" className="display flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ink text-[17px] text-lime">
                {w.name.charAt(0)}
              </span>
              <span className={cn("flex min-w-0 flex-1", grid ? "flex-col" : "items-center justify-between gap-2")}>
                <span>{w.name}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
                  Not installed <ExternalIcon />
                </span>
              </span>
            </a>
          );
        }
        return (
          <button
            key={w.id}
            type="button"
            disabled={!!connecting}
            onClick={() => void connectWith(w.id)}
            className={cn("lift flex items-center text-left font-bold text-ink disabled:cursor-wait", tile)}
          >
            <span aria-hidden="true" className="display flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ink text-[17px] text-lime">
              {w.name.charAt(0)}
            </span>
            <span className="flex-1">{w.name}</span>
            {busy ? (
              <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted">
                <Spinner size={16} track="var(--color-line)" />
                {!grid && "Opening"}
              </span>
            ) : grid ? null : (
              <ChevronRight />
            )}
          </button>
        );
      })}
      {connectError && (
        <p role="alert" className={cn("slidein m-0 text-[13px] font-semibold text-error", grid && "col-span-full")}>
          {connectError}
        </p>
      )}
    </div>
  );
}
