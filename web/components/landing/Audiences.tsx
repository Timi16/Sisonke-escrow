import Image from "next/image";
import { cn } from "@/lib/cn";

const CARDS = [
  {
    src: "/images/freelance.jpg",
    alt: "A freelancer laughing at her laptop in a café",
    title: "Freelance gigs",
    body: "A client in the US locks the fee. A designer in Lagos starts work knowing it’s there.",
  },
  {
    src: "/images/market.jpg",
    alt: "A tomato seller at Bodija Market, Ibadan",
    title: "Online sales",
    body: "Order from a stall you found on Instagram. Pay in, they ship, you release when it lands.",
  },
  {
    src: "/images/trade.jpg",
    alt: "A young man grinning and giving the OK sign",
    title: "Group-chat trades",
    body: "Swap with someone you met yesterday, without either of you going first.",
  },
];

export function Audiences() {
  return (
    <section id="made-for" className="mx-auto flex max-w-[1240px] flex-col gap-3.5 px-[18px] py-10 min-[720px]:gap-12 min-[720px]:px-8 min-[720px]:pt-32 min-[720px]:pb-[120px]">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <h2 className="m-0 font-serif min-[720px]:max-w-[13ch] text-[38px] leading-[1.02] font-normal tracking-[-0.02em] min-[720px]:text-[clamp(42px,4.6vw,68px)]">
          For every deal where trust is still new.
        </h2>
        <p className="m-0 hidden max-w-[26em] text-lg leading-[1.6] text-muted min-[720px]:block">
          If you’ve ever hesitated before paying someone, or before starting work for someone, this is for you.
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3.5 min-[720px]:gap-5">
        {CARDS.map((c, i) => (
          <article
            key={c.title}
            className={cn(
              "flex flex-col gap-4 rounded-[24px] bg-sand px-2.5 pt-2.5 pb-[22px] min-[720px]:gap-[22px] min-[720px]:rounded-panel min-[720px]:px-3.5 min-[720px]:pt-3.5 min-[720px]:pb-7",
              i === 2 && "max-[719px]:hidden",
            )}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-note bg-photo-2 min-[720px]:rounded-box">
              <Image src={c.src} alt={c.alt} fill sizes="(min-width: 1240px) 380px, (min-width: 720px) 45vw, 100vw" className="object-cover" />
            </div>
            <div className="flex flex-col gap-1.5 px-2.5 min-[720px]:gap-2.5 min-[720px]:px-3.5">
              <h3 className="display m-0 text-[26px] min-[720px]:text-[30px]">{c.title}</h3>
              <p className="m-0 text-[15px] leading-[1.55] text-muted min-[720px]:text-base">{c.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
