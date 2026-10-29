import { AppFooter } from "@/components/layout/AppFooter";
import { AppHeader } from "@/components/layout/AppHeader";
import { ContractNotices } from "@/components/layout/ContractNotices";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <AppHeader />
      <div className="flex-1">
        <ContractNotices>{children}</ContractNotices>
      </div>
      <AppFooter />
    </div>
  );
}
