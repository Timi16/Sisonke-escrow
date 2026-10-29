"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TTL_BUMP_AGE, config, explorer } from "@/lib/config";
import { formatWhenZone, padId, shortAddress } from "@/lib/format";
import { formatUsdc } from "@/lib/sisonke/amount";
import { encode } from "@/lib/sisonke/contract";
import { isFinal, type EscrowView, type Role } from "@/lib/sisonke/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { Countdown } from "@/components/ui/Countdown";
import { useTx } from "@/components/tx/TxProvider";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted min-[720px]:text-[13px]">{label}</dt>
      <dd className="m-0 text-sm font-semibold min-[720px]:text-[15px]">{children}</dd>
    </div>
  );
}

const linkCls = "inline-flex min-h-11 items-center text-[13px] font-bold text-violet";

export function DetailsCard({ view, role, ledgerNow, className }: { view: EscrowView; role: Role; ledgerNow: number | null; className?: string }) {
  const e = view.escrow;
  const tx = useTx();
  const old = !isFinal(e.status) && ledgerNow !== null && ledgerNow - e.createdAt > TTL_BUMP_AGE;
  return (
    <section aria-labelledby="details-h" className={cn("rise flex flex-col gap-4 rounded-tile border border-line bg-card p-[18px] min-[720px]:rounded-card min-[720px]:px-[26px] min-[720px]:py-6", className)} style={{ animationDelay: "240ms" }}>
      <h2 id="details-h" className="m-0 text-base font-bold">
        Details
      </h2>
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-x-7 gap-y-4 max-[719px]:grid-cols-2 max-[719px]:gap-x-3.5 max-[719px]:gap-y-3">
        <Item label="Escrow ID">{padId(e.id.toString())}</Item>
        <Item label="Amount">{formatUsdc(e.amount)} USDC</Item>
        <Item label="Deadline">
          <span className="flex flex-col">
            <span>{formatWhenZone(e.deadline)}</span>
            <span className="text-[13px] font-normal text-muted">
              {view.deadlinePassed ? "Passed" : isFinal(e.status) ? "Closed before it" : <Countdown to={e.deadline} />}
            </span>
          </span>
        </Item>
        <Item label="Created">{formatWhenZone(e.createdAt)}</Item>
        <Item label="Network">Stellar Testnet</Item>
        <Item label="Token">
          <span className="flex flex-col">
            <span>USDC issued by Circle</span>
            <span className="flex flex-wrap items-center gap-x-3 font-normal">
              <span title={config.usdcSacId} className="font-mono text-[13px]">
                {shortAddress(config.usdcSacId)}
              </span>
              <a href={explorer.contract(config.usdcSacId)} target="_blank" rel="noopener noreferrer" className={linkCls}>
                Explorer
              </a>
            </span>
          </span>
        </Item>
        <Item label="Contract">
          <span className="flex flex-wrap items-center gap-x-3 font-normal">
            <span title={config.contractId} className="font-mono text-sm">
              {shortAddress(config.contractId)}
            </span>
            <CopyButton value={config.contractId} ariaLabel="Copy the contract id" />
            <a href={explorer.contract()} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Explorer
            </a>
          </span>
        </Item>
        <Item label="Terms hash">{e.termsHash ? <span className="break-all font-mono text-[13px]">{e.termsHash}</span> : "None"}</Item>
      </dl>
      {old && role !== "guest" && (
        <div className="flex flex-wrap items-center gap-x-3 border-t border-sand pt-3 text-[13px] text-muted">
          <span>This record is over 60 days old. Anyone can renew its storage.</span>
          <button
            type="button"
            aria-disabled={tx.busy || undefined}
            onClick={() =>
              !tx.busy &&
              void tx.run({
                key: `escrow:${e.id}`,
                label: "Keep this escrow stored",
                job: { kind: "invoke", method: "extend_escrow_ttl", args: encode.id(e.id) },
                escrow: e,
              })
            }
            className="min-h-11 px-0.5 text-[13px] font-bold text-violet"
          >
            Keep this escrow stored
          </button>
        </div>
      )}
    </section>
  );
}
