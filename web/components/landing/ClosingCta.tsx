import Link from "next/link";

export function ClosingCta() {
  return (
    <section className="mx-auto flex max-w-[1240px] flex-col items-center gap-10 px-[18px] pb-20 text-center min-[720px]:px-8 min-[720px]:pb-32">
      <h2 aria-label="Deal with anyone. Trust the contract." className="m-0 flex flex-col items-center font-display font-normal uppercase leading-[0.95]">
        <span aria-hidden="true" className="inline-block bg-ink px-[26px] pt-4 pb-5 text-[clamp(40px,5.4vw,78px)] text-on-ink">
          Deal with anyone.
        </span>
        <span
          aria-hidden="true"
          className="-mt-3 inline-block bg-violet px-[22px] pt-3 pb-4 text-[clamp(36px,5vw,70px)] text-white shadow-stamp"
          style={{ transform: "rotate(3deg)" }}
        >
          Trust the contract.
        </span>
      </h2>
      <p className="m-0 max-w-[30em] text-lg leading-[1.6] text-muted">For freelance gigs, marketplace sales and trades with someone from the group chat.</p>
      <Link
        href="/new"
        className="cta display inline-flex min-h-16 items-center rounded-pill bg-lime px-9 text-2xl text-ink no-underline shadow-cta-ring hover:text-ink"
      >
        Start an escrow
      </Link>
    </section>
  );
}
