import Link from "next/link";
import { LogoMark } from "@/components/ui/Logo";

function Party({ role, name, address }: { role: string; name: string; address: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-box border border-ink-line bg-ink-2 px-4 py-[18px]">
      <span className="text-[13px] text-on-ink-muted">{role}</span>
      <span className="text-[17px] font-bold">{name}</span>
      <span className="font-mono text-xs text-on-ink-muted">{address}</span>
    </div>
  );
}

function Arrow({ dir, label }: { dir: "left" | "right"; label: string }) {
  const head = (
    <svg width="9" height="12" viewBox="0 0 9 12" aria-hidden="true">
      <path d={dir === "left" ? "M9 0 L0 6 L9 12 Z" : "M0 0 L9 6 L0 12 Z"} fill="var(--color-ink-btn-line)" />
    </svg>
  );
  return (
    <div className="flex flex-col gap-2.5 px-1.5">
      <div className="relative flex h-3 items-center">
        {dir === "left" && head}
        <span className="h-0.5 flex-1 bg-ink-line" />
        {dir === "right" && head}
        <span
          aria-hidden="true"
          className={`${dir === "left" ? "pulse-l" : "pulse-r"} absolute top-px left-0 size-2.5 rounded-pill bg-lime opacity-0 shadow-lime-glow`}
        />
      </div>
      <span className="text-center text-xs leading-[1.35] text-on-ink-muted">{label}</span>
    </div>
  );
}

/** The dark "one rule" section: payer → held here → recipient (Main board); three cells on a phone. */
export function RuleFigure() {
  return (
    <section id="rule" className="px-3 min-[720px]:px-8">
      <div className="mx-auto grid max-w-[1376px] grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] items-center gap-x-[72px] gap-y-[18px] rounded-panel bg-ink px-5 py-[30px] text-on-ink min-[720px]:gap-y-14 min-[720px]:rounded-section min-[720px]:px-[clamp(24px,5vw,88px)] min-[720px]:py-[clamp(40px,6vw,96px)]">
        <div className="flex flex-col gap-[18px] min-[720px]:gap-6">
          <span className="inline-flex min-h-8 items-center self-start rounded-pill border-[1.5px] border-on-ink px-3.5 text-[13px] font-semibold min-[720px]:min-h-9 min-[720px]:px-4 min-[720px]:text-[15px]">
            The one rule
          </span>
          <h2 className="m-0 font-serif text-[38px] leading-[1.02] font-normal tracking-[-0.02em] min-[720px]:text-[clamp(42px,4.6vw,68px)]">
            Money only moves toward the other person.
          </h2>
          {/* Phone: the three-cell figure sits between the heading and the text. */}
          <div aria-hidden="true" className="grid grid-cols-3 gap-1.5 text-center min-[720px]:hidden">
            <div className="flex flex-col gap-0.5 rounded-field border border-ink-line bg-ink-2 px-1.5 py-3">
              <span className="text-[11px] text-on-ink-muted">Payer</span>
              <span className="text-[15px] font-bold">Megan</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-field bg-lime px-1.5 py-3 text-ink">
              <span className="text-[11px] font-semibold">Contract</span>
              <span className="text-[15px] font-bold">Held here</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-field border border-ink-line bg-ink-2 px-1.5 py-3">
              <span className="text-[11px] text-on-ink-muted">Recipient</span>
              <span className="text-[15px] font-bold">Kemi</span>
            </div>
          </div>
          <p className="m-0 max-w-[32em] text-[15px] leading-[1.6] text-on-ink-muted min-[720px]:text-lg">
            The payer can release it but can’t pull it back early. The recipient can refund it but can’t pay themselves. The contract
            checks every signature, so the rule holds even if someone skips this website.
          </p>
          <Link
            href="/rules"
            className="cta display flex min-h-[54px] items-center justify-center self-stretch rounded-pill bg-lime px-[30px] text-xl text-ink no-underline hover:text-ink min-[720px]:inline-flex min-[720px]:min-h-[60px] min-[720px]:self-start min-[720px]:text-[22px]"
          >
            Read the rules
          </Link>
        </div>
        <figure
          aria-label="The contract sits between payer and recipient. Release goes to the recipient, signed by the payer. Refund goes to the payer, signed by the recipient."
          className="m-0 hidden grid-cols-[minmax(0,1fr)_minmax(40px,0.8fr)_auto_minmax(40px,0.8fr)_minmax(0,1fr)] items-center min-[720px]:grid"
        >
          <Party role="Payer" name="Megan" address="GCX4…7QPA" />
          <Arrow dir="left" label="Refund, signed by the recipient" />
          <div className="flex size-[132px] flex-col items-center justify-center gap-2 rounded-[30px] border border-olive bg-ink-2 shadow-held">
            <LogoMark size={58} stroke={2} ring="var(--color-on-ink)" lens="var(--color-lime)" />
            <span className="text-[13px] font-bold">Held here</span>
          </div>
          <Arrow dir="right" label="Release, signed by the payer" />
          <Party role="Recipient" name="Kemi" address="GBQ7…K2LD" />
        </figure>
      </div>
    </section>
  );
}
