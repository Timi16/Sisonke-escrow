import type { Metadata } from "next";
import { Suspense } from "react";
import { FindScreen } from "./FindScreen";

export const metadata: Metadata = {
  title: "Find an escrow",
  description: "Look up any Sisonke escrow on Stellar Testnet by its ID or link. Viewing doesn't need a wallet.",
};

export default function FindPage() {
  // useSearchParams (?id=42) is request data: read it inside the boundary.
  return (
    <Suspense fallback={<FindScreen fallback />}>
      <FindScreen />
    </Suspense>
  );
}
