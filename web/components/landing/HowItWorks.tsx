import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";

const STEPS = [
  { n: "01", title: "Create", body: "Who gets paid, how much, and a deadline. One signature saves it on-chain." },
  { n: "02", title: "Deposit", body: "The USDC moves into the contract. The other side can see it’s really there." },
  {
    n: "03",
    title: "Release or refund",
    body: "The payer releases when the work is in. The recipient refunds if it falls apart. It’s final either way.",
  },
];

/** Three steps plus the illustrative demo escrow card (marketing story, not chain data). */
export function HowItWorks() {
  return (
    <section id="how" className="px-3 pt-10 min-[720px]:px-8 min-[720px]:pt-0">
      <div className="mx-auto grid max-w-[1376px] grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] items-center gap-x-[72px] gap-y-10 rounded-panel bg-ink px-5 py-[30px] text-on-ink min-[720px]:gap-y-14 min-[720px]:rounded-section min-[720px]:px-[clamp(24px,5vw,88px)] min-[720px]:py-[clamp(40px,6vw,96px)]">
        <div className="flex flex-col gap-[26px]">
          <span className="inline-flex min-h-9 items-center self-start rounded-pill border-[1.5px] border-on-ink px-4 text-[15px] font-semibold">
            How it works
          </span>
          <h2 className="m-0 font-serif text-[38px] leading-[1.02] font-normal tracking-[-0.02em] min-[720px]:text-[clamp(42px,4.6vw,68px)]">
            Three steps from handshake to payout.
          </h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-start gap-4 rounded-note border border-ink-line bg-ink-2 px-5 py-[18px]">
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border-[1.5px] border-on-ink text-[15px] font-semibold">
                  {s.n}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[19px] font-semibold">{s.title}</span>
                  <span className="text-[15px] leading-normal text-on-ink-muted">{s.body}</span>
                </div>
              </li>
            ))}
          </ol>
          <Link
            href="/new"
            className="cta display inline-flex min-h-[60px] items-center self-start rounded-pill bg-lime px-[30px] text-[22px] text-ink no-underline hover:text-ink"
          >
            Get started
          </Link>
        </div>
        <div aria-label="Example escrow, for illustration" role="img" className="flex flex-col gap-6 rounded-panel bg-ground p-[22px] text-ink shadow-demo min-[720px]:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">Escrow #0042</span>
            <StatusChip status="Funded" size="compact" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Megan’s payment for the café logo</span>
            <p className="display m-0 text-[48px] leading-[0.98] min-[720px]:text-[64px]">Safe in the middle.</p>
            <span className="text-[15px] leading-normal text-muted">Neither of them can grab it. It moves when the work is done.</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              ["Payer", "Megan", "Can release"],
              ["Recipient", "Kemi", "Can refund"],
            ].map(([role, name, can]) => (
              <div key={role} className="flex flex-col gap-[3px] rounded-field bg-sand p-3.5">
                <span className="text-xs text-muted">{role}</span>
                <span className="text-[15px] font-bold">{name}</span>
                <span className="text-xs text-muted">{can}</span>
              </div>
            ))}
          </div>
          <span className="flex min-h-[54px] items-center justify-center rounded-pill bg-ink text-base font-bold text-on-ink">Release payment</span>
        </div>
      </div>
    </section>
  );
}
