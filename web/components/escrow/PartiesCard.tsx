"use client";
import { cn } from "@/lib/cn";
import { addressLink } from "@/lib/config";
import { useArbiterStats } from "@/lib/hooks/queries";
import type { Escrow, Role } from "@/lib/sisonke/types";
import { CopyButton } from "@/components/ui/CopyButton";

function Party({ label, address, you }: { label: string; address: string; you: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-t border-sand py-3 first:border-t-0 first:pt-0">
      <dt className="flex items-center gap-2 text-[13px] text-muted">
        {label}
        {you && <span className="pop rounded-pill bg-ink px-2.5 py-0.5 text-xs font-bold text-on-ink">You</span>}
      </dt>
      <dd className="m-0 flex flex-col gap-0.5">
        <span className="break-all font-mono text-sm">{address}</span>
        <span className="flex flex-wrap items-center gap-x-4">
          <CopyButton value={address} ariaLabel={`Copy the ${label.toLowerCase()}'s address`} />
          {addressLink(address) && (
            <a href={addressLink(address)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-bold text-violet">
            Explorer
          </a>
          )}
        </span>
      </dd>
    </div>
  );
}

/** The arbiter's record, for everyone (WEB_PLAN §6.6). */
export function ArbiterRecord({ arbiter }: { arbiter: string }) {
  const stats = useArbiterStats(arbiter);
  if (stats.isPending) return <span className="text-muted">Checking the arbiter&apos;s record…</span>;
  if (!stats.data) return <span className="text-muted">Couldn&apos;t read the arbiter&apos;s record.</span>;
  const s = stats.data;
  return (
    <span>
      Arbiter on {s.count} funded escrow{s.count === 1 ? "" : "s"}.{" "}
      {s.decided
        ? `Decided ${s.decided} dispute${s.decided === 1 ? "" : "s"}: ${s.forRecipient} for the recipient, ${s.forPayer} for the payer, ${s.split} split.`
        : "No decisions yet."}
    </span>
  );
}

/** Payer, recipient and arbiter with full addresses (INTEGRATION §6). */
export function PartiesCard({ escrow, role, className }: { escrow: Escrow; role: Role; className?: string }) {
  return (
    <section aria-labelledby="parties-h" className={cn("rise flex flex-col gap-4 rounded-tile border border-line bg-card p-[18px] min-[720px]:rounded-card min-[720px]:px-[26px] min-[720px]:py-6", className)} style={{ animationDelay: "220ms" }}>
      <h2 id="parties-h" className="m-0 text-base font-bold">
        Who&apos;s in it
      </h2>
      <dl className="m-0 flex flex-col">
        <Party label="Payer" address={escrow.payer} you={role === "payer"} />
        <Party label="Recipient" address={escrow.recipient} you={role === "recipient"} />
        {escrow.arbiter ? (
          <Party label="Arbiter" address={escrow.arbiter} you={role === "arbiter"} />
        ) : (
          <div className="flex flex-col gap-1 border-t border-sand pt-3">
            <dt className="text-[13px] text-muted">Arbiter</dt>
            <dd className="m-0 text-sm leading-normal">
              No arbiter: no dispute is possible. The money moves only by the payer&apos;s release, the recipient&apos;s refund, or the payer&apos;s reclaim after the deadline.
            </dd>
          </div>
        )}
      </dl>
      {escrow.arbiter && (
        <p className="m-0 flex flex-col gap-1 rounded-note bg-sand px-4 py-3 text-sm leading-normal">
          <span>Chosen by the payer. They can split the money if either of you opens a dispute before the deadline.</span>
          <ArbiterRecord arbiter={escrow.arbiter} />
        </p>
      )}
    </section>
  );
}
