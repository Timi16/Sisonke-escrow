import type { Metadata } from "next";
import { EscrowsScreen } from "./EscrowsScreen";

export const metadata: Metadata = {
  title: "Escrows",
  description: "Every Sisonke escrow you're paying, receiving or arbitrating, read live from Stellar Testnet.",
};

export default function EscrowsPage() {
  return <EscrowsScreen />;
}
