import { Fragment } from "react";
import { LogoMark } from "@/components/ui/Logo";

const DESKTOP = ["Nobody goes first", "Money locked on Stellar", "Release or refund", "Receipts anyone can check"];
const PHONE = ["Nobody goes first", "Release or refund", "Receipts anyone can check"];

/** The rotated lime band. Decorative: the same words appear elsewhere on the page. */
export function Marquee() {
  return (
    <div aria-hidden="true" className="mb-0 overflow-hidden py-4 min-[720px]:mb-6 min-[720px]:py-7">
      <div className="-mx-[30px] -rotate-2 overflow-hidden bg-lime py-3.5 min-[720px]:-mx-10 min-[720px]:py-[22px]">
        <div className="marquee hidden w-max items-center gap-10 font-display text-[46px] leading-none whitespace-nowrap uppercase min-[720px]:flex">
          {[...DESKTOP, ...DESKTOP].map((t, i) => (
            <Fragment key={i}>
              <span>{t}</span>
              <LogoMark size={40} stroke={2.6} lens="var(--color-ink)" />
            </Fragment>
          ))}
        </div>
        <div className="marquee-phone flex w-max gap-7 font-display text-[30px] leading-none whitespace-nowrap uppercase min-[720px]:hidden">
          {[...PHONE, ...PHONE].map((t, i) => (
            <Fragment key={i}>
              <span>{t}</span>
              <span>●</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
