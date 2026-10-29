import { ContractNotices } from "@/components/layout/ContractNotices";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

/** Marketing pages (landing, rules): site header, contract notices, violet footer. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader />
      <div className="flex-1">
        <ContractNotices>{children}</ContractNotices>
      </div>
      <SiteFooter />
    </div>
  );
}
