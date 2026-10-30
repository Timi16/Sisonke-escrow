"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/ui/Logo";

const VARIANTS = {
  landing: {
    links: [
      { href: "#how", label: "How it works" },
      { href: "#made-for", label: "Who it’s for" },
      { href: "#faq", label: "FAQ" },
    ],
    open: "/overview",
    radius: "rounded-pill",
  },
  rules: {
    links: [
      { href: "#who", label: "Who can do what" },
      { href: "#rejects", label: "What gets rejected" },
      { href: "#proof", label: "Proof" },
    ],
    open: "/overview",
    radius: "rounded-[32px]",
  },
} as const;

/** Landing and rules header: white pill, anchor nav, lime "Open app" (Main and Rules boards). */
export function SiteHeader() {
  const v = usePathname() === "/rules" ? VARIANTS.rules : VARIANTS.landing;
  return (
    <header>
      {/* Phone (Phone-Landing board): logo plus "Open app". */}
      <div className="sticky top-0 z-20 bg-header-glass px-3.5 py-3 min-[720px]:hidden">
        <div className="flex items-center justify-between gap-2.5 rounded-pill border border-line bg-card py-1.5 pr-1.5 pl-3.5">
          <Logo markSize={24} textSize={20} />
          <Link
            href={v.open}
            className="inline-flex min-h-11 items-center rounded-pill bg-lime px-[18px] text-sm font-bold text-ink no-underline hover:text-ink"
          >
            Open app
          </Link>
        </div>
      </div>
      <div className="rise-lg mx-auto hidden max-w-[1240px] px-8 py-[18px] min-[720px]:block">
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-7 gap-y-3 border border-line bg-card py-2.5 pr-2.5 pl-5",
            v.radius,
          )}
        >
          <Logo markSize={30} textSize={24} className="gap-2.5" />
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-7 gap-y-1.5 text-base font-medium">
            {v.links.map((l) => (
              <a key={l.href} href={l.href} className="no-underline">
                {l.label}
              </a>
            ))}
            <Link
              href={v.open}
              className="cta inline-flex min-h-12 items-center rounded-pill bg-lime px-6 font-bold text-ink no-underline hover:text-ink"
            >
              Open app
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
