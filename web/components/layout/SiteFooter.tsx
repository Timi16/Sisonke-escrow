"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { config, explorer, repoLink } from "@/lib/config";
import { LogoMark } from "@/components/ui/Logo";

const ABOUT = "Sisonke is isiZulu for “all of us, together.”";
const TESTNET = "Stellar Testnet only. No real funds.";
const CREDIT = "Photos on Unsplash by Vitaly Gariev, Iwaria, Joyce Busola and Tunde Buremo.";

function FooterLogo({ mark, text }: { mark: number; text: number }) {
  return (
    <Link href="/" aria-label="Sisonke home" className="flex items-center gap-3 self-start text-white no-underline hover:text-white">
      <LogoMark size={mark} ring="white" lens="var(--color-lime)" />
      <span className="font-bold tracking-[-0.03em]" style={{ fontSize: text }}>
        sisonke
      </span>
    </Link>
  );
}

const linkCls = "text-white no-underline hover:text-lime";

/** Violet footer: the full one on the landing page, the slim one on /rules. */
export function SiteFooter() {
  const repo = repoLink();
  if (usePathname() === "/rules") {
    return (
      <footer className="bg-violet text-white">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-10 gap-y-5 px-4 pt-14 pb-10 min-[720px]:px-8">
          <FooterLogo mark={36} text={30} />
          <div className="flex flex-wrap gap-x-7 gap-y-2 text-[15px] text-lilac">
            <span>{ABOUT}</span>
            <span>{TESTNET}</span>
          </div>
        </div>
      </footer>
    );
  }
  return (
    <footer className="bg-violet text-white">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-3.5 px-[18px] pt-8 pb-10 min-[720px]:gap-14 min-[720px]:px-8 min-[720px]:pt-20 min-[720px]:pb-12">
        <div className="flex flex-wrap justify-between gap-x-16 gap-y-10">
          <span className="min-[720px]:hidden">
            <FooterLogo mark={32} text={28} />
          </span>
          <span className="hidden min-[720px]:block">
            <FooterLogo mark={44} text={40} />
          </span>
          <div className="hidden flex-wrap gap-x-24 gap-y-10 min-[720px]:flex">
            <nav aria-label="Product" className="flex flex-col gap-3.5 text-[17px]">
              <span className="text-[15px] text-lilac">Product</span>
              <Link href="/dashboard" className={linkCls}>
                Open app
              </Link>
              <Link href="/new" className={linkCls}>
                Start an escrow
              </Link>
              <Link href="/rules" className={linkCls}>
                Rules and proof
              </Link>
            </nav>
            <nav aria-label="Build" className="flex flex-col gap-3.5 text-[17px]">
              <span className="text-[15px] text-lilac">Build</span>
              {repo && (
                <a href={repo} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  GitHub
                </a>
              )}
              <a href={explorer.contract()} target="_blank" rel="noopener noreferrer" className={linkCls}>
                Stellar Expert
              </a>
              <a href={config.labUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
                Stellar Lab
              </a>
            </nav>
          </div>
        </div>
        <div className="flex flex-col gap-3.5 text-sm text-lilac min-[720px]:flex-row min-[720px]:flex-wrap min-[720px]:justify-between min-[720px]:gap-x-10 min-[720px]:gap-y-3 min-[720px]:border-t min-[720px]:border-white/25 min-[720px]:pt-7 min-[720px]:text-[15px]">
          <span>{ABOUT}</span>
          <span>{TESTNET}</span>
          <span>{CREDIT}</span>
        </div>
      </div>
    </footer>
  );
}
