import type { Metadata } from "next";
import { OverviewScreen } from "./OverviewScreen";

export const metadata: Metadata = {
  title: "Overview",
  description: "What needs you, what's locked, and what moved: your Sisonke escrows on Stellar Testnet at a glance.",
};

export default function OverviewPage() {
  return <OverviewScreen />;
}
