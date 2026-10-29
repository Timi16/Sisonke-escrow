import { Audiences } from "@/components/landing/Audiences";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { Faq } from "@/components/landing/Faq";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Marquee } from "@/components/landing/Marquee";
import { ProofCard } from "@/components/landing/ProofCard";
import { RuleFigure } from "@/components/landing/RuleFigure";
import { RulesTable } from "@/components/landing/RulesTable";
import { WhyCopy } from "@/components/landing/WhyCopy";

/** "/" — Main.dc.html (desktop) and Phone-Landing.dc.html (below 720px). */
export default function LandingPage() {
  return (
    <main id="main">
      <Hero />
      <Marquee />
      <WhyCopy />
      <RuleFigure />
      <Audiences />
      <HowItWorks />
      <RulesTable />
      <ProofCard />
      <Faq />
      <ClosingCta />
    </main>
  );
}
