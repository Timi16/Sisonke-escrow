import { CloseIcon } from "@/components/ui/icons";

/** The board's seven refusals plus the two arbiter ones (WEB_PLAN §3.7). */
export const REFUSALS = [
  "A release signed by anyone except the payer.",
  "A refund signed by anyone except the recipient.",
  "A second deposit into an escrow that’s already funded.",
  "Any release, refund or reclaim once it’s Released or Refunded.",
  "A release or refund before anything is deposited.",
  "A reclaim before the deadline, or a deposit after it.",
  "An escrow for zero USDC, or one where you pay yourself.",
  "A dispute on an escrow with no arbiter, or after the deadline.",
  "A decision by anyone except the escrow’s arbiter, or before a dispute.",
];

export function Refusals() {
  return (
    <div className="rise-lg flex min-w-0 flex-[999_1_460px] flex-col gap-[22px]">
      <h2 className="m-0 font-serif text-[clamp(38px,4.4vw,60px)] leading-[1.02] font-normal">What the contract refuses</h2>
      <p className="m-0 text-[17px] leading-[1.6] text-muted">The transaction fails and the money stays exactly where it was.</p>
      <ul className="m-0 flex list-none flex-col border-t-[1.5px] border-ink p-0">
        {REFUSALS.map((r) => (
          <li key={r} className="flex gap-3.5 border-b border-line-strong py-4 text-[17px] leading-[1.45]">
            <CloseIcon size={20} color="var(--color-error)" className="mt-0.5 shrink-0" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
