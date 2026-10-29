import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-[640px] flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <span aria-hidden="true" className="wobble flex size-20 items-center justify-center rounded-pill border-[1.5px] border-ink bg-sand display text-3xl">
        ?
      </span>
      <h1 className="display m-0 text-[clamp(40px,4.6vw,64px)]">Nothing here.</h1>
      <p className="m-0 text-[15px] leading-[1.55] text-muted">
        That page doesn&apos;t exist. Escrows live in the contract on Stellar, not on this site, so nothing was lost.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="lift inline-flex min-h-12 items-center rounded-pill border-[1.5px] border-ink bg-lime px-[22px] text-[15px] font-bold text-ink no-underline">
          Go home
        </Link>
        <Link href="/find" className="lift inline-flex min-h-12 items-center rounded-pill border-[1.5px] border-ink bg-card px-[22px] text-[15px] font-bold text-ink no-underline">
          Find an escrow
        </Link>
      </div>
    </main>
  );
}
