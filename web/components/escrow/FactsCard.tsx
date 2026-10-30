"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TTL_BUMP_AGE, addressLink, config, explorer } from "@/lib/config";
import { formatDayName, formatEnds, shortAddress } from "@/lib/format";
import { useArbiterStats } from "@/lib/hooks/queries";
import { formatUsdc } from "@/lib/sisonke/amount";
import { encode } from "@/lib/sisonke/contract";
import { isFinal, type EscrowView, type Role } from "@/lib/sisonke/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { Countdown } from "@/components/ui/Countdown";
import { useTx } from "@/components/tx/TxProvider";

const link = "inline-flex min-h-8 items-center text-[13px] font-bold text-violet";

function Fact({ k, children, sub, you = false }: { k: string; children: ReactNode; sub?: ReactNode; you?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className={cn("m-0 text-[15px] font-bold [overflow-wrap:anywhere]", you && "text-violet")}>{children}</dd>
      {sub && <dd className="m-0 text-[13px] text-muted">{sub}</dd>}
    </div>
  );
}

/** "GCX4…7QPA" with Copy and Explorer. */
function Who({ address, label }: { address: string; label: string }) {
  const href = addressLink(address);
  return (
    <span className="flex flex-wrap items-center gap-x-3">
      <span title={address} className="font-mono text-sm">
        {shortAddress(address)}
      </span>
      <CopyButton value={address} ariaLabel={`Copy the ${label}'s address`} className="!min-h-8" />
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
          Explorer
        </a>
      )}
    </span>
  );
}

/** The arbiter's record, for everyone (WEB_PLAN §6.6). */
export function ArbiterRecord({ arbiter }: { arbiter: string }) {
  const stats = useArbiterStats(arbiter);
  if (stats.isPending) return <>Checking their record…</>;
  if (!stats.data) return <>Couldn&apos;t read their record.</>;
  const s = stats.data;
  return (
    <>
      Arbiter on {s.count} funded escrow{s.count === 1 ? "" : "s"}.{" "}
      {s.decided ? `Decided ${s.decided}: ${s.forRecipient} for the recipient, ${s.forPayer} for the payer, ${s.split} split.` : "No decisions yet."}
    </>
  );
}

/** Amount, deadline, the three parties, token and contract (Escrow board "facts"). */
export function FactsCard({ view, role, ledgerNow }: { view: EscrowView; role: Role; ledgerNow: number | null }) {
  const e = view.escrow;
  const tx = useTx();
  const closed = isFinal(e.status);
  const old = !closed && ledgerNow !== null && ledgerNow - e.createdAt > TTL_BUMP_AGE;
  return (
    <section aria-label="Parties and details" className="rise flex flex-col gap-4 rounded-panel border border-line bg-card p-[22px]" style={{ animationDelay: "140ms" }}>
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-x-5 gap-y-[18px] max-[480px]:grid-cols-2 max-[480px]:gap-x-3">
        <Fact k="Amount" sub="Testnet USDC">
          {formatUsdc(e.amount)} USDC
        </Fact>
        <Fact k="Deadline" sub={closed ? "No longer matters" : view.deadlinePassed ? "Passed" : <Countdown to={e.deadline} />}>
          {formatEnds(e.deadline)}
        </Fact>
        <Fact k="Arbiter" you={role === "arbiter"} sub={e.arbiter ? (role === "arbiter" ? "You" : "Chosen by the payer") : "No disputes possible"}>
          {e.arbiter ? <Who address={e.arbiter} label="arbiter" /> : "None"}
        </Fact>
        <Fact k="Created" sub="Stellar Testnet">
          {formatDayName(e.createdAt)}
        </Fact>
        <Fact k="Payer" you={role === "payer"} sub={role === "payer" ? "You" : undefined}>
          <Who address={e.payer} label="payer" />
        </Fact>
        <Fact k="Recipient" you={role === "recipient"} sub={role === "recipient" ? "You" : undefined}>
          <Who address={e.recipient} label="recipient" />
        </Fact>
        <Fact
          k="Token"
          sub={
            <a href={explorer.contract(config.usdcSacId)} target="_blank" rel="noopener noreferrer" className={link}>
              {shortAddress(config.usdcSacId)} on Explorer
            </a>
          }
        >
          USDC by Circle
        </Fact>
        <Fact
          k="Contract"
          sub={
            <a href={explorer.contract()} target="_blank" rel="noopener noreferrer" className={link}>
              Explorer
            </a>
          }
        >
          <span className="flex flex-wrap items-center gap-x-3">
            <span title={config.contractId} className="font-mono text-sm">
              {shortAddress(config.contractId)}
            </span>
            <CopyButton value={config.contractId} ariaLabel="Copy the contract id" className="!min-h-8" />
          </span>
        </Fact>
        {e.termsHash && (
          <Fact k="Terms hash">
            <span className="font-mono text-[13px] font-normal">{e.termsHash}</span>
          </Fact>
        )}
      </dl>
      {e.arbiter && (
        <p className="m-0 rounded-note bg-ground px-4 py-3 text-[13px] leading-normal text-muted">
          The payer chose the arbiter. They can split the money only if one of you opens a dispute before the deadline. <ArbiterRecord arbiter={e.arbiter} />
        </p>
      )}
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
