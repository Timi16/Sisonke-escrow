"use client";
import { config } from "@/lib/config";
import { formatWhen, padId } from "@/lib/format";
import { useEscrow } from "@/lib/hooks/queries";
import proof from "@/lib/generated/proof.json";
import { Address } from "@/components/ui/Address";
import { StatusChip } from "@/components/ui/StatusChip";
import { TxHash } from "@/components/ui/TxHash";

type Row = (typeof proof)[number];

/** Scenario A of the Testnet run (create → fund → release), with its real hashes. */
const A: Row[] = proof.filter((r) => r.scenario === "A" && r.hash);
const ESCROW_ID = A[0]?.escrow_id ?? "3";

const LABEL: Record<string, string> = {
  create: "Escrow created",
  fund: "Payment locked in",
  release: "Released to the recipient",
};

export function ProofCard() {
  // Times come from the contract record, so nothing here is made up.
  const view = useEscrow(ESCROW_ID).data;
  const e = view?.escrow;
  const when: Record<string, number | undefined> = { create: e?.createdAt, fund: e?.fundedAt, release: e?.closedAt };
  return (
    <section id="proof" className="px-3 min-[720px]:px-8">
      <div className="mx-auto grid max-w-[1376px] grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] items-center gap-x-[72px] gap-y-12 rounded-panel bg-sand px-5 py-10 min-[720px]:rounded-section min-[720px]:px-[clamp(24px,5vw,88px)] min-[720px]:py-[clamp(40px,6vw,88px)]">
        <div className="flex flex-col gap-5">
          <h2 className="m-0 font-serif text-[38px] leading-[1.02] font-normal tracking-[-0.02em] min-[720px]:text-[clamp(42px,4.6vw,64px)]">
            Don’t trust us. Check the receipts.
          </h2>
          <p className="m-0 max-w-[30em] text-lg leading-[1.6] text-muted">
            Every step is a public Stellar transaction. Open any of them on Stellar Expert to see who signed, what moved and when.
          </p>
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-[15px] text-muted">
            Contract <Address address={config.contractId} kind="contract" className="text-ink" />
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-[24px] bg-card p-[22px] shadow-proof min-[720px]:p-[26px]">
          <div className="flex items-center justify-between gap-3 pb-3.5">
            <span className="text-[17px] font-bold">Escrow {padId(ESCROW_ID)}</span>
            <StatusChip status={e?.status ?? "Released"} size="compact" />
          </div>
          {A.map((r) => (
            <div key={r.hash} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-sand py-3.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{LABEL[r.method] ?? r.step}</span>
                <span className="text-[13px] text-muted">
                  Payer signed{when[r.method] ? `, ${formatWhen(when[r.method]!)}` : ""}
                </span>
              </div>
              <TxHash hash={r.hash!} className="self-start" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
