import Link from "next/link";

export function WhyCopy() {
  return (
    <section className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-x-16 gap-y-[18px] px-[18px] py-10 min-[720px]:gap-y-8 min-[720px]:px-8 min-[720px]:pt-[88px] min-[720px]:pb-[120px]">
      <div className="flex-[1_1_220px] min-[720px]:max-w-[300px]">
        <span className="inline-flex min-h-8 items-center rounded-pill border-[1.5px] border-ink px-3.5 text-[13px] font-semibold min-[720px]:min-h-9 min-[720px]:px-4 min-[720px]:text-[15px]">
          Why Sisonke
        </span>
      </div>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px] min-[720px]:gap-8">
        <p className="m-0 font-serif text-[30px] leading-[1.15] tracking-[-0.015em] min-[720px]:text-[clamp(32px,3.4vw,48px)]">
          You found the perfect designer online, half a world away. You’ve never met. So who pays first?
        </p>
        <p className="m-0 font-serif text-[30px] leading-[1.15] tracking-[-0.015em] text-muted min-[720px]:text-[clamp(32px,3.4vw,48px)]">
          With Sisonke, nobody has to guess.
          <span className="hidden min-[720px]:inline">
            {" "}
            The money waits in a Stellar smart contract where you can both see it, and it only ever moves toward the other person.
          </span>
        </p>
        <Link
          href="/new"
          className="cta display hidden min-h-[60px] items-center self-start rounded-pill bg-lime px-[30px] text-[22px] text-ink no-underline shadow-cta-ring hover:text-ink min-[720px]:inline-flex"
        >
          Start an escrow
        </Link>
      </div>
    </section>
  );
}
