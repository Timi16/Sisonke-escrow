"use client";
import type { ReactNode } from "react";
import { config, repoLink } from "@/lib/config";
import { duration, groupInt } from "@/lib/format";
import { useContractBalance, useInfo } from "@/lib/hooks/queries";
import { formatUsdc } from "@/lib/sisonke/amount";
import { Address } from "@/components/ui/Address";
import { CopyButton } from "@/components/ui/CopyButton";
import { Skeleton } from "@/components/ui/Skeleton";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-[15px] font-semibold">{children}</dd>
    </div>
  );
}

const loading = <Skeleton className="h-5 w-24" />;

/** Live facts about the deployed contract (INTEGRATION §2): admin, notice period, locked funds, code hash. */
export function AboutContract() {
  const info = useInfo().data?.info;
  const balance = useContractBalance().data;
  const verify = `stellar contract fetch --id ${config.contractId} --network testnet | shasum -a 256`;
  const guide = repoLink("/blob/main/docs/UPGRADES.md#shipping-a-v2");
  return (
    <section id="about" aria-labelledby="about-h" className="px-3 pb-[72px] min-[720px]:px-8 min-[720px]:pb-28">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-7 rounded-card border border-line bg-card px-[22px] py-7 min-[720px]:px-10 min-[720px]:py-10">
        <div className="flex flex-col gap-3">
          <h2 id="about-h" className="m-0 font-serif text-[clamp(34px,3.6vw,48px)] leading-[1.02] font-normal">
            About this contract
          </h2>
          <p className="m-0 max-w-[40em] text-[15px] leading-[1.6] text-muted">
            Read live from the contract on Stellar Testnet. The admin can pause new escrows and deposits, and can upgrade the code only after
            the public notice period below. It can’t move, freeze or redirect an escrow.
          </p>
        </div>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-x-7 gap-y-5">
          <Item label="Contract">
            <Address address={config.contractId} kind="contract" />
          </Item>
          <Item label="Version">{info ? `${info.version} (storage ${info.storageVersion})` : loading}</Item>
          <Item label="Admin">{info ? <Address address={info.admin} /> : loading}</Item>
          <Item label="Upgrade notice period">{info ? duration(info.upgradeDelay) : loading}</Item>
          <Item label="Upgrades">{info ? (info.upgradesLocked ? "The code is final" : "Enabled, after the notice period") : loading}</Item>
          <Item label="Escrows created">{info ? groupInt(info.escrowCount) : loading}</Item>
          <Item label="Locked in escrows">{info ? `${formatUsdc(info.totalLocked)} USDC` : loading}</Item>
          <Item label="Contract’s USDC balance">{balance !== undefined ? `${formatUsdc(balance)} USDC` : loading}</Item>
        </dl>
        <div className="flex flex-col gap-2.5 border-t border-sand pt-5">
          <span className="text-[13px] text-muted">Code hash (wasm), as deployed</span>
          <span className="font-mono text-[13px] break-all">{config.wasmHash}</span>
          <span className="text-[13px] text-muted">Check it yourself: the output must equal the hash above, or the one in the latest upgrade event.</span>
          <code className="relative block overflow-x-auto rounded-field bg-ground px-4 py-3 font-mono text-[13px] whitespace-pre">{verify}</code>
          <div className="flex flex-wrap items-center gap-x-5">
            <CopyButton value={verify} label="Copy command" ariaLabel="Copy the verification command" />
            {guide && (
              <a href={guide} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-bold text-violet">
                How upgrades are checked
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
