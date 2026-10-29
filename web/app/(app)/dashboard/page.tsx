import type { Metadata } from "next";
import { DashboardScreen } from "./DashboardScreen";

export const metadata: Metadata = {
  title: "My escrows",
  description: "Every Sisonke escrow you're paying, receiving or arbitrating, read live from Stellar Testnet.",
};

export default function DashboardPage() {
  return <DashboardScreen />;
}
