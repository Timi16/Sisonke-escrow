import type { Metadata } from "next";
import { AboutContract } from "@/components/rules/AboutContract";
import { PrincipleCards } from "@/components/rules/PrincipleCards";
import { ProofGrid } from "@/components/rules/ProofGrid";
import { Refusals } from "@/components/rules/Refusals";
import { SignerTable } from "@/components/rules/SignerTable";
import { StatusTrack } from "@/components/rules/StatusTrack";

export const metadata: Metadata = {
  title: "Rules and proof",
  description: "Who can do what with a Sisonke escrow, what the contract refuses, and every Testnet transaction that proves it.",
};

/** "/rules" — Rules.dc.html, with the full signer table and an "About this contract" section. */
export default function RulesPage() {
  return (
    <main id="main">
      <section className="mx-auto flex max-w-[1240px] flex-col gap-8 px-[18px] pt-8 pb-16 min-[720px]:px-8 min-[720px]:pt-12 min-[720px]:pb-24">
        <h1 aria-label="The rules, in full." className="rise-lg m-0 flex flex-col items-start font-display font-normal uppercase leading-[0.95]">
          <span aria-hidden="true" className="inline-block bg-ink px-[26px] pt-4 pb-5 text-[clamp(48px,6.4vw,92px)] text-on-ink">
            The rules,
          </span>
          <span
            aria-hidden="true"
            className="stamp-rules -mt-3 ml-8 inline-block bg-tomato px-6 pt-3 pb-4 text-[clamp(48px,6.4vw,92px)] text-stamp-text shadow-stamp min-[720px]:ml-12"
            style={{ transform: "rotate(-4deg)" }}
          >
            in full.
          </span>
        </h1>
        <p className="rise-lg m-0 max-w-[26em] font-serif text-[clamp(26px,2.8vw,36px)] leading-[1.2]" style={{ animationDelay: "140ms" }}>
          Everything here is enforced by the Sisonke contract on Stellar. The app only offers what the contract accepts, and the contract
          refuses the rest, even if someone skips the app entirely.
        </p>
        <StatusTrack />
      </section>
      <SignerTable />
      <section id="rejects" className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-x-[72px] gap-y-14 px-[18px] py-[72px] min-[720px]:px-8 min-[720px]:py-28">
        <Refusals />
        <PrincipleCards />
      </section>
      <ProofGrid />
      <AboutContract />
    </main>
  );
}
