import type { Metadata } from "next";
import { SetupScreen } from "./SetupScreen";

export const metadata: Metadata = {
  title: "Test funds",
  description: "Free Testnet XLM and USDC: connect a wallet, get test XLM, enable USDC and swap on the Testnet DEX.",
};

export default function SetupPage() {
  return <SetupScreen />;
}
