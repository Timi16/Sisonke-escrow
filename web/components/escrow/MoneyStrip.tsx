import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { formatUsdc } from "@/lib/sisonke/amount";
import { moneyPosition, statusSentence, type Cell } from "@/lib/sisonke/status";
import type { EscrowView, Role } from "@/lib/sisonke/types";
import { LogoMark } from "@/components/ui/Logo";

const FILL = { ground: "bg-ground", lime: "bg-lime", lilac: "bg-lilac" } as const;

function YouBadge() {
  return <span className="pop mt-1 rounded-pill bg-ink px-2.5 py-0.5 text-[11px] font-bold text-on-ink min-[720px]:text-xs">You</span>;
}

function PartyCell({ label, address, you, fill }: { label: string; address: string; you: boolean; fill?: keyof typeof FILL }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1 rounded-field px-0.5 py-2.5 transition-colors duration-500 min-[720px]:rounded-box min-[720px]:px-1.5 min-[720px]:py-3.5", fill && FILL[fill])}>
      <span className="text-[11px] font-semibold text-muted min-[720px]:text-[13px]">{label}</span>
      <span title={address} className="max-w-full truncate font-mono text-[13px] font-semibold min-[720px]:text-[15px]">
        {shortAddress(address)}
      </span>
      {you && <YouBadge />}
    </div>
  );
}

/** "Where the money is": the coin on the dashed track, three cells, one sentence. */
export function MoneyStrip({ view, role }: { view: EscrowView; role: Role }) {
  const e = view.escrow;
  const pos = moneyPosition(e);
  const cell = (c: Cell) => pos.highlight[c];
  return (
    <section
      aria-label="Where the money is"
      className="rise flex flex-col gap-3 rounded-[24px] border border-line bg-card px-2.5 pt-5 pb-[18px] min-[720px]:gap-[18px] min-[720px]:rounded-panel min-[720px]:px-[clamp(14px,3vw,32px)] min-[720px]:pt-7 min-[720px]:pb-[26px]"
      style={{ animationDelay: "120ms" }}
    >
      <div aria-hidden="true" className="relative h-12 min-[720px]:h-14">
        <span
          className="absolute top-[23px] right-[16.66%] left-[16.66%] h-0.5 min-[720px]:top-[27px]"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--color-ink) 0 8px, transparent 8px 16px)" }}
        />
        {["16.66%", "50%", "83.33%"].map((left) => (
          <span
            key={left}
            className="absolute top-[19px] -ml-[5px] size-2.5 rounded-pill border-2 border-ink bg-ground min-[720px]:top-[22px] min-[720px]:-ml-1.5 min-[720px]:size-3"
            style={{ left }}
          />
        ))}
        <span
          className="bob coin-move absolute top-0.5 flex size-11 items-center justify-center rounded-pill border-2 border-ink bg-lime shadow-coin min-[720px]:top-1 min-[720px]:size-12"
          style={{ left: pos.coinLeft, opacity: pos.coinFaded ? 0.35 : 1, transform: "translateX(-50%)" }}
        >
          <LogoMark size={24} stroke={2.6} />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center min-[720px]:gap-2">
        <PartyCell label="Payer" address={e.payer} you={role === "payer"} fill={cell("payer")} />
        <div
          className={cn(
            "flex min-w-0 flex-col items-center gap-1 rounded-field px-0.5 py-2.5 transition-colors duration-500 min-[720px]:rounded-box min-[720px]:px-1.5 min-[720px]:py-3.5",
            cell("contract") && FILL[cell("contract")!],
          )}
        >
          <span className="text-[11px] font-semibold text-muted min-[720px]:text-[13px]">Contract holds</span>
          <span className="display tabular text-[24px] min-[720px]:text-[clamp(24px,3.2vw,40px)]">{formatUsdc(pos.contractHolds)}</span>
          <span className="text-[11px] font-semibold text-muted min-[720px]:text-xs">
            <span className="min-[720px]:hidden">USDC · </span>
            {pos.caption}
          </span>
        </div>
        <PartyCell label="Recipient" address={e.recipient} you={role === "recipient"} fill={cell("recipient")} />
      </div>
      <p aria-live="polite" className="m-0 border-t border-sand pt-3 text-center text-[13px] leading-normal text-muted min-[720px]:pt-4 min-[720px]:text-[15px] min-[720px]:leading-[1.55]">
        {statusSentence(view, role)}
      </p>
    </section>
  );
}
