import type { Metadata } from "next";
import { NewEscrowScreen } from "./NewEscrowScreen";

export const metadata: Metadata = {
  title: "New escrow",
  description: "Create a Sisonke escrow on Stellar Testnet: who you're paying, how much, and the deadline.",
};

export default function NewEscrowPage() {
  return <NewEscrowScreen />;
}
