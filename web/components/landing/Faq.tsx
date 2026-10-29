"use client";
import { useId, useState } from "react";
import { deployment } from "@/lib/generated/deployment";
import { duration } from "@/lib/format";
import { useInfo } from "@/lib/hooks/queries";

/** Answers corrected per WEB_PLAN §11 (arbiter path, upgrade notice period). */
function faqs(notice: string) {
  return [
    {
      q: "Does Sisonke ever hold my money?",
      a: `No. Your USDC sits in the escrow contract on Stellar, and this website has no keys. The contract’s admin can’t move, freeze or redirect an escrow. It can upgrade the code only after a public notice period (${notice}), and this site shows a warning on every page while one is pending.`,
    },
    {
      q: "Who can release or refund?",
      a: "Only the payer can release, and only to the recipient. Only the recipient can refund, and only to the payer. Nobody else’s signature works. If the payer named an arbiter, the arbiter can split the money, but only after one of you opens a dispute.",
    },
    {
      q: "What if the other person disappears?",
      a: "If the deadline passes and the money is still locked, the payer can take it back, unless a dispute was opened before it. Then the arbiter decides. Before the deadline, it stays exactly where it is.",
    },
    {
      q: "Can money be paid out twice?",
      a: "No. Once an escrow is Released, Refunded or Split it’s closed, and the contract rejects any second attempt.",
    },
    { q: "Is this real money?", a: "Not yet. Sisonke runs on Stellar Testnet with test USDC, so you can try every step for free." },
    { q: "Which wallets can I use?", a: "Varial (formerly Freighter), xBull, Lobstr, Albedo and Hana. You approve every step in your own wallet." },
  ];
}

export function Faq() {
  const [open, setOpen] = useState(0);
  const id = useId();
  const delay = useInfo().data?.info?.upgradeDelay ?? Number(deployment.SISONKE_UPGRADE_DELAY);
  const list = faqs(duration(delay));
  return (
    <section id="faq" className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-x-20 gap-y-10 px-[18px] py-16 min-[720px]:px-8 min-[720px]:py-32">
      <h2 className="m-0 flex-[1_1_320px] font-serif text-[38px] leading-[1.02] font-normal tracking-[-0.02em] min-[720px]:text-[clamp(42px,4.6vw,64px)]">
        Questions, answered.
      </h2>
      <div className="flex min-w-0 flex-[999_1_520px] flex-col border-t-[1.5px] border-ink">
        {list.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className="border-b border-line-strong">
              <h3 className="m-0">
                <button
                  type="button"
                  id={`${id}-q${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`${id}-a${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex min-h-[72px] w-full items-center justify-between gap-5 border-0 bg-transparent py-[18px] text-left text-lg font-semibold text-ink min-[720px]:text-xl"
                >
                  <span>{f.q}</span>
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 22 22"
                    fill="none"
                    aria-hidden="true"
                    className="shrink-0 transition-transform duration-[250ms]"
                    style={{ transform: isOpen ? "rotate(45deg)" : "rotate(0deg)" }}
                  >
                    <path d="M11 3v16M3 11h16" stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </h3>
              <div id={`${id}-a${i}`} role="region" aria-labelledby={`${id}-q${i}`} hidden={!isOpen}>
                <p className="m-0 pr-12 pb-6 text-[17px] leading-[1.6] text-muted">{f.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
