import type { Metadata } from "next";
import { SetupScreen } from "./SetupScreen";

export const metadata: Metadata = {
  title: "Wallet setup",
  description: "Connect a Stellar wallet, get test XLM, add a USDC trustline and get test USDC: four steps, once.",
};

export default function SetupPage() {
  return <SetupScreen />;
}
