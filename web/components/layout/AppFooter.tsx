"use client";
import { config } from "@/lib/config";
import { duration } from "@/lib/format";
import { useInfo } from "@/lib/hooks/queries";
import { Address } from "@/components/ui/Address";

/** Slim footer on app pages: contract, notice period, admin (INTEGRATION §2). */
export function AppFooter() {
  const info = useInfo().data?.info;
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-6 text-[13px] text-muted min-[720px]:px-6">
        <span className="inline-flex flex-wrap items-center gap-x-2">
          Contract <Address address={config.contractId} kind="contract" className="text-ink" />
        </span>
        {info && (
          <span>
            {info.upgradesLocked ? "Code is final" : <>Upgrade notice: {duration(info.upgradeDelay)}</>}
          </span>
        )}
        {info && (
          <span className="inline-flex flex-wrap items-center gap-x-2">
            Admin <Address address={info.admin} copy={false} className="text-ink" />
          </span>
        )}
        <span className="ml-auto">Stellar Testnet only. No real funds.</span>
      </div>
    </footer>
  );
}
