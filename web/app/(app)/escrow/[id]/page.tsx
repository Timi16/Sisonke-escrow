import type { Metadata } from "next";
import { Suspense } from "react";
import { EscrowScreen, EscrowSkeleton } from "./EscrowScreen";

// No chain read here, and never the escrow's own title: it would block every
// page load on RPC, and titles are untrusted text (WEB_PLAN §6.8).
export async function generateMetadata({ params }: PageProps<"/escrow/[id]">): Promise<Metadata> {
  const { id } = await params;
  const safe = /^\d{1,15}$/.test(id) ? id : "";
  return {
    title: safe ? `Escrow #${safe}` : "Escrow",
    description: "A Sisonke escrow on Stellar Testnet. Open it to see where the money is and who can move it.",
  };
}

export default function EscrowPage({ params }: PageProps<"/escrow/[id]">) {
  // The id is runtime data: read it inside the boundary.
  return (
    <Suspense fallback={<EscrowSkeleton />}>
      <EscrowScreen params={params} />
    </Suspense>
  );
}
