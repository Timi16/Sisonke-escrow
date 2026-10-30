import { notFound } from "next/navigation";
import {
  MigrationCard,
  MisconfiguredCard,
  PausedBanner,
  UpgradeBanner,
  WrongNetworkBanner,
} from "@/components/layout/ContractNotices";
import { Networks } from "@stellar/stellar-sdk";

// Fixed values: no clock reads at render (Cache Components), same output every time.
const NOW = 1_793_000_000;
const PENDING = {
  hash: "4f1c2a9e7b3d5f60812a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d",
  eta: NOW + 52 * 60 + 10,
  expiresAt: NOW + 7 * 86_400,
};

function Label({ children }: { children: string }) {
  return <h2 className="m-0 mt-4 font-mono text-[13px] font-semibold text-muted">{children}</h2>;
}

/** Every contract notice state, for review and screenshots. Not served in production. */
export default function NoticesPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main id="main" className="flex flex-col gap-3">
      <h1 className="m-0 font-serif text-[clamp(28px,2.6vw,31px)] font-normal leading-none tracking-[-0.02em]">Contract notices</h1>
      <Label>UpgradeBanner · beforeEta, code published</Label>
      <UpgradeBanner state="beforeEta" pending={PENDING} ledgerNow={NOW} codePublished />
      <Label>UpgradeBanner · beforeEta, code not published</Label>
      <UpgradeBanner state="beforeEta" pending={PENDING} ledgerNow={NOW} codePublished={false} />
      <Label>UpgradeBanner · live</Label>
      <UpgradeBanner state="live" pending={{ ...PENDING, eta: NOW - 60 }} ledgerNow={NOW} codePublished />
      <Label>UpgradeBanner · expired</Label>
      <UpgradeBanner state="expired" pending={{ ...PENDING, eta: NOW - 8 * 86_400, expiresAt: NOW - 86_400 }} ledgerNow={NOW} codePublished />
      <Label>PausedBanner</Label>
      <PausedBanner />
      <Label>WrongNetworkBanner · Public network</Label>
      <WrongNetworkBanner walletPassphrase={Networks.PUBLIC} />
      <Label>WrongNetworkBanner · another network</Label>
      <WrongNetworkBanner walletPassphrase="Some private network" />
      <Label>MigrationCard · connected</Label>
      <MigrationCard canRun />
      <Label>MigrationCard · no wallet</Label>
      <MigrationCard canRun={false} />
      <Label>MisconfiguredCard</Label>
      <MisconfiguredCard reason="This app is pointed at a contract that doesn't use Testnet USDC, so Sisonke won't show it." />
    </main>
  );
}
