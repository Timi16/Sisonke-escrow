"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LogoMark } from "@/components/ui/Logo";
import { CheckIcon } from "@/components/ui/icons";

/** Copy corrected per WEB_PLAN §11: an arbiter and an upgrade path exist, so no "nobody else can touch it". */
export const HERO_LEAD =
  "Sisonke holds the money in a smart contract until the job is done. The payer releases it. The recipient can send it back. This website never holds your keys or your money.";

function DocIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4h9l5 5v11H5z" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 4v5h5" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function StoryCard({
  icon,
  iconClass,
  title,
  sub,
  chip,
  chipClass,
  className,
  style,
}: {
  icon: ReactNode;
  iconClass: string;
  title: string;
  sub: string;
  chip: string;
  chipClass: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("flex items-center gap-3.5 rounded-box bg-card px-4 py-3.5 shadow-float", className)} style={style}>
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-icon", iconClass)}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold">{title}</span>
        <span className="text-[13px] text-muted">{sub}</span>
      </div>
      <span className={cn("shrink-0 rounded-pill px-[11px] py-[5px] text-xs font-bold", chipClass)}>{chip}</span>
    </div>
  );
}

const SHOWN: React.CSSProperties = { opacity: 1, transform: "translateY(0) scale(1)" };
const HIDDEN: React.CSSProperties = { opacity: 0, transform: "translateY(18px) scale(0.97)" };

/**
 * The three story cards appear one by one, then loop (Main board script:
 * phases at 0 / 900 / 2500 / 4100 ms, every 8600 ms). Under reduced motion the
 * cycle never starts and all three stay visible.
 */
function useCardCycle() {
  const [phase, setPhase] = useState(3);
  useEffect(() => {
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* no matchMedia: animate as designed */
    }
    if (reduce) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      timers.forEach(clearTimeout);
      setPhase(0);
      timers = [
        setTimeout(() => setPhase(1), 900),
        setTimeout(() => setPhase(2), 2500),
        setTimeout(() => setPhase(3), 4100),
        setTimeout(cycle, 8600),
      ];
    };
    cycle();
    return () => timers.forEach(clearTimeout);
  }, []);
  return phase;
}

function Photo({ src, alt, position, label, dot }: { src: string; alt: string; position: string; label: string; dot: string }) {
  return (
    <div className="relative h-[300px] overflow-hidden rounded-tile bg-photo min-[720px]:h-auto min-[720px]:min-h-[600px] min-[720px]:rounded-panel">
      <Image
        src={src}
        alt={alt}
        fill
        preload
        sizes="(min-width: 1240px) 300px, (min-width: 720px) 45vw, 50vw"
        className="object-cover"
        style={{ objectPosition: position }}
      />
      <span className="absolute top-2.5 left-2.5 inline-flex min-h-7 items-center gap-1.5 rounded-pill bg-card px-2.5 text-xs font-bold shadow-badge min-[720px]:top-[18px] min-[720px]:left-[18px] min-[720px]:min-h-[34px] min-[720px]:gap-2 min-[720px]:px-3.5 min-[720px]:text-sm">
        <span aria-hidden="true" className={cn("size-[7px] rounded-pill min-[720px]:size-2", dot)} />
        {label}
      </span>
    </div>
  );
}

export function Hero() {
  const phase = useCardCycle();
  return (
    <section
      id="top"
      className="mx-auto grid max-w-[1240px] grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))] items-center gap-7 px-[18px] pt-5 pb-9 min-[720px]:gap-14 min-[720px]:px-8 min-[720px]:pt-12 min-[720px]:pb-28"
    >
      <div className="flex flex-col gap-[22px] min-[720px]:gap-8">
        <h1
          aria-label="Nobody has to go first."
          className="rise-lg m-0 flex flex-col items-start font-display font-normal uppercase leading-[0.95] tracking-[0.005em]"
        >
          <span aria-hidden="true" className="inline-block bg-ink px-4 pt-3 pb-3.5 text-[44px] text-on-ink min-[720px]:px-[26px] min-[720px]:pt-[18px] min-[720px]:pb-[22px] min-[720px]:text-[clamp(48px,5.6vw,82px)]">
            Nobody has to
          </span>
          <span
            aria-hidden="true"
            className="stamp -mt-2.5 ml-7 inline-block bg-tomato px-4 pt-2.5 pb-3 text-[50px] text-stamp-text shadow-stamp min-[720px]:-mt-3.5 min-[720px]:ml-14 min-[720px]:px-6 min-[720px]:pt-3.5 min-[720px]:pb-[18px] min-[720px]:text-[clamp(52px,6vw,90px)]"
            style={{ transform: "rotate(-4deg)" }}
          >
            Go first.
          </span>
        </h1>
        <p
          className="rise-lg m-0 max-w-[30em] text-[17px] leading-[1.55] text-pretty text-muted min-[720px]:text-[21px]"
          style={{ animationDelay: "160ms" }}
        >
          {HERO_LEAD}
        </p>
        <div className="rise-lg flex flex-wrap items-center gap-x-7 gap-y-4" style={{ animationDelay: "260ms" }}>
          <Link
            href="/new"
            className="cta display flex min-h-[58px] w-full items-center justify-center rounded-pill bg-lime px-[34px] text-[22px] text-ink no-underline shadow-cta-ring hover:text-ink min-[720px]:inline-flex min-[720px]:min-h-16 min-[720px]:w-auto min-[720px]:text-2xl"
          >
            Start an escrow
          </Link>
          <a href="#how" className="hidden text-[17px] font-semibold underline decoration-2 underline-offset-[6px] min-[720px]:inline">
            See how it works
          </a>
        </div>
        <p className="rise-lg m-0 text-center text-[13px] leading-[1.6] text-muted min-[720px]:text-left min-[720px]:text-sm" style={{ animationDelay: "320ms" }}>
          Free on Stellar Testnet. Works with Varial (formerly Freighter), xBull, Lobstr, Albedo and Hana.
        </p>
      </div>

      <div className="rise-lg relative pb-[46px] min-[720px]:pb-0" style={{ animationDelay: "200ms" }}>
        <div className="grid grid-cols-2 gap-2 min-[720px]:gap-3">
          <Photo src="/images/hero-payer.jpg" alt="Megan, a café owner in Atlanta, smiling in her apron" position="50% 30%" label="Megan in Atlanta" dot="bg-tomato" />
          <Photo src="/images/hero-recipient.jpg" alt="Kemi, a designer in Lagos, smiling with her laptop" position="50% 20%" label="Kemi in Lagos" dot="bg-violet" />
        </div>
        <span
          aria-hidden="true"
          className="absolute top-[120px] left-1/2 flex size-[54px] -translate-x-1/2 items-center justify-center rounded-pill border-4 border-ground bg-lime shadow-coin-lg min-[720px]:top-[34%] min-[720px]:size-[68px] min-[720px]:-translate-y-1/2"
        >
          <LogoMark size={38} className="size-[30px] min-[720px]:size-[38px]" />
        </span>

        {/* Desktop: three cards that appear in turn. */}
        <div className="hidden min-[720px]:block">
          <StoryCard
            className="hero-card absolute bottom-[216px] -left-8 w-[min(330px,86%)]"
            style={phase >= 1 ? SHOWN : HIDDEN}
            icon={<LogoMark size={28} ring="var(--color-on-ink)" lens="var(--color-lime)" />}
            iconClass="bg-ink"
            title="Money locked in"
            sub="Megan’s payment is safe in the contract"
            chip="Locked"
            chipClass="bg-lime"
          />
          <StoryCard
            className="hero-card absolute bottom-[124px] -left-8 w-[min(330px,86%)]"
            style={phase >= 2 ? SHOWN : HIDDEN}
            icon={<DocIcon />}
            iconClass="bg-sand"
            title="Work delivered"
            sub="Kemi sent the final logo"
            chip="Delivered"
            chipClass="bg-sand"
          />
          <StoryCard
            className="hero-card absolute bottom-8 -left-8 w-[min(330px,86%)]"
            style={phase >= 3 ? SHOWN : HIDDEN}
            icon={<CheckIcon size={22} color="var(--color-ink)" />}
            iconClass="bg-lime"
            title="Payment released"
            sub="Kemi got paid in seconds"
            chip="Paid"
            chipClass="bg-ink text-on-ink"
          />
        </div>
        {/* Phone: only "Payment released" (Phone-Landing board). */}
        <div className="absolute right-3 bottom-0 left-3 flex items-center gap-3 rounded-note bg-card px-3.5 py-3 shadow-float-sm min-[720px]:hidden">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-icon bg-lime">
            <CheckIcon size={20} color="var(--color-ink)" />
          </span>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-bold">Payment released</span>
            <span className="text-xs text-muted">Kemi got paid in seconds</span>
          </div>
          <span className="rounded-pill bg-ink px-2.5 py-1 text-[11px] font-bold text-on-ink">Paid</span>
        </div>
      </div>
    </section>
  );
}
