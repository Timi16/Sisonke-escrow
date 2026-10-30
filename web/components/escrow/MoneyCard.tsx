import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { formatUsdc } from "@/lib/sisonke/amount";
import { moneyCard, statusSentence, type HoldTone } from "@/lib/sisonke/status";
import type { EscrowView, Role } from "@/lib/sisonke/types";
import { WalletIcon } from "@/components/ui/icons";

const TONE: Record<HoldTone, string> = {
  awaiting: "border-[1.5px] border-dashed border-faint bg-ground text-ink",
  lime: "bg-lime text-ink",
  violet: "bg-violet text-white",
  ink: "bg-ink text-on-ink",
  line: "bg-line text-ink",
  split: "bg-card text-violet shadow-[inset_0_0_0_2px_var(--color-violet)]",
  muted: "bg-sand text-muted",
};

function Party({ label, address, you, lit }: { label: string; address: string; you: boolean; lit: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <span className={cn("flex size-[58px] items-center justify-center rounded-pill border-2 border-ink transition-colors duration-500", lit && "bg-lime")}>
        <WalletIcon size={24} />
      </span>
      <span className="text-[13px] text-muted">{label}</span>
      <span title={address} className="max-w-full truncate font-mono text-[13px] font-semibold">
        {shortAddress(address)}
      </span>
      {you && <span className="pop rounded-pill bg-ink px-2.5 py-0.5 text-xs font-bold text-on-ink">You</span>}
    </div>
  );
}

/** "Where the money is": payer ring, the status pill with the amount, recipient ring, one line. */
export function MoneyCard({ view, role }: { view: EscrowView; role: Role }) {
  const e = view.escrow;
  const m = moneyCard(e);
  return (
    <section aria-label="Where the money is" className="rise flex flex-col gap-[18px] rounded-shell border border-line bg-card p-[22px] max-[480px]:px-3" style={{ animationDelay: "80ms" }}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-2.5">
        <Party label="Payer" address={e.payer} you={role === "payer"} lit={m.payerLit} />
        <div className={cn("flex flex-col items-center gap-1 rounded-tile px-3 py-[18px] text-center transition-colors duration-[400ms]", TONE[m.tone])}>
          <span className="text-[13px] font-semibold">{m.label}</span>
          <span className="display tabular text-[clamp(28px,2.9vw,33px)]">{formatUsdc(m.shown)}</span>
          <span className="text-xs font-bold">{m.unit}</span>
        </div>
        <Party label="Recipient" address={e.recipient} you={role === "recipient"} lit={m.recipientLit} />
      </div>
      <p aria-live="polite" className="m-0 border-t border-sand pt-4 text-center text-sm leading-normal text-muted">
        {statusSentence(view)}
      </p>
    </section>
  );
}
