"use client";
/**
 * Contract-level notices under the header, on every page (WEB_PLAN §6.7):
 * Misconfigured (replaces the page) → wrong network → upgrade → paused → migration.
 * The banners are presentational so /dev/notices can render every state.
 */
import { Networks } from "@stellar/stellar-sdk";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { repoLink } from "@/lib/config";
import { countdown, duration, formatWhenZone, shortHash } from "@/lib/format";
import { useCodeExists, useInfo } from "@/lib/hooks/queries";
import { useLedgerClock } from "@/lib/hooks/useLedgerClock";
import { encode } from "@/lib/sisonke/contract";
import { upgradeNotice, type UpgradeState } from "@/lib/sisonke/notices";
import type { PendingUpgrade } from "@/lib/sisonke/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { BangIcon, WarnIcon } from "@/components/ui/icons";
import { useTx } from "@/components/tx/TxProvider";
import { useWallet } from "@/components/wallet/WalletProvider";

const GUIDANCE =
  "If you don't trust it, settle your escrows before then. As a payer before your deadline you can release to the recipient, or ask them to refund you. As a recipient you can refund the payer. In a dispute, ask the arbiter to decide. After an escrow's deadline, the payer can reclaim.";

function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("slidein mx-auto mt-3 w-full max-w-[1240px] px-4 min-[720px]:px-6", className)}>{children}</div>;
}

export function UpgradeBanner({
  state,
  pending,
  ledgerNow,
  codePublished,
}: {
  state: Exclude<UpgradeState, "none">;
  pending: PendingUpgrade;
  ledgerNow: number | null;
  /** Null while unknown. */
  codePublished: boolean | null;
}) {
  const howTo = repoLink("/blob/main/docs/UPGRADES.md#shipping-a-v2");
  if (state === "expired") {
    return (
      <Wrap>
        <div role="status" className="rounded-tile bg-sand px-5 py-4 text-sm leading-normal">
          The proposed upgrade expired and can&apos;t run. A new proposal would start a new notice period.
        </div>
      </Wrap>
    );
  }
  return (
    <Wrap>
      <section aria-label="Upgrade notice" className="flex flex-col gap-3 rounded-tile bg-ink p-5 text-on-ink">
        <div className="flex flex-wrap items-start gap-4">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-icon bg-lime">
            <WarnIcon color="var(--color-ink)" />
          </span>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2 text-[15px] leading-normal">
            {state === "beforeEta" ? (
              <p className="m-0">
                An upgrade of this contract has been proposed (code <span className="font-mono">{shortHash(pending.hash)}</span>{" "}
                <CopyButton value={pending.hash} ariaLabel="Copy the proposed code hash" className="!text-lilac" />) and can take effect
                from <strong>{formatWhenZone(pending.eta)}</strong>{" "}
                {ledgerNow !== null && <span className="display tabular text-lg text-lime">({countdown(pending.eta - ledgerNow)})</span>}. {GUIDANCE}
              </p>
            ) : (
              <p className="m-0">
                An upgrade of this contract (code <span className="font-mono">{shortHash(pending.hash)}</span>) <strong>can take effect at any moment until {formatWhenZone(pending.expiresAt)}</strong>. {GUIDANCE}
              </p>
            )}
            {howTo && (
              <a href={howTo} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-bold text-lilac hover:text-lilac">
                How to check this code
              </a>
            )}
          </div>
        </div>
        {codePublished === false && (
          <p className="m-0 flex items-start gap-2.5 rounded-note bg-error-bg px-4 py-3 text-sm font-semibold text-error">
            <BangIcon size={18} className="shrink-0" />
            The proposed code isn&apos;t published yet, so nobody can review it. Treat this proposal as hostile.
          </p>
        )}
      </section>
    </Wrap>
  );
}

export function PausedBanner() {
  return (
    <Wrap>
      <div role="status" className="flex items-start gap-3 rounded-tile bg-sand px-5 py-4 text-sm leading-normal">
        <WarnIcon size={18} className="mt-px shrink-0" />
        New escrows and deposits are paused by the contract admin. Every way out still works.
      </div>
    </Wrap>
  );
}

export function WrongNetworkBanner({ walletPassphrase }: { walletPassphrase: string | null }) {
  const name = walletPassphrase === Networks.PUBLIC ? "Public network" : "another network";
  return (
    <Wrap>
      <div role="alert" className="flex items-start gap-3 rounded-tile border-[1.5px] border-error bg-error-bg px-5 py-4 text-sm font-semibold leading-normal text-error">
        <BangIcon size={18} className="mt-px shrink-0" />
        Your wallet is on {name}. Switch it to Testnet to sign. You can still look around.
      </div>
    </Wrap>
  );
}

export function MigrationCard({ onRun, busy, canRun }: { onRun?: () => void; busy?: boolean; canRun: boolean }) {
  return (
    <Wrap>
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-tile bg-sand px-5 py-4 text-sm leading-normal">
        <span className="flex-[1_1_320px]">A contract migration is pending. Writes are paused until someone runs it. Anyone can.</span>
        {canRun ? (
          <button
            type="button"
            onClick={onRun}
            aria-disabled={busy || undefined}
            className="lift min-h-11 rounded-pill border-[1.5px] border-ink bg-lime px-5 text-sm font-bold text-ink"
          >
            {busy ? "Running…" : "Run the migration"}
          </button>
        ) : (
          <span className="text-muted">Connect a wallet to run it.</span>
        )}
      </div>
    </Wrap>
  );
}

export function MisconfiguredCard({ reason }: { reason: string }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-9 pb-24 min-[720px]:px-6">
      <section role="alert" className="flex max-w-[640px] flex-col gap-3.5 rounded-card border-[1.5px] border-error bg-card p-[26px] shadow-action">
        <span className="flex size-[52px] items-center justify-center rounded-pill border-[1.5px] border-error bg-error-bg">
          <BangIcon />
        </span>
        <h1 className="m-0 font-serif text-[34px] font-normal leading-none">Sisonke can&apos;t show this contract</h1>
        <p className="m-0 text-[15px] leading-[1.55] text-muted">{reason}</p>
        <p className="m-0 text-[13px] text-muted">No escrow data is shown until this is fixed.</p>
      </section>
    </main>
  );
}

/** Live notices, then the page (or the Misconfigured card instead of it). */
export function ContractNotices({ children }: { children: ReactNode }) {
  const info = useInfo();
  const { address, onTestnet, walletPassphrase } = useWallet();
  const { ledgerNow } = useLedgerClock(1000);
  const tx = useTx();
  const pending = info.data?.info?.pendingUpgrade ?? null;
  const code = useCodeExists(pending?.hash ?? null);
  const state = upgradeNotice(info.data?.info ?? null, ledgerNow);
  const migrationPending = tx.current?.error?.code === 141;

  if (info.data?.misconfigured) return <MisconfiguredCard reason={info.data.misconfigured.reason} />;
  return (
    <>
      {address && onTestnet === false && <WrongNetworkBanner walletPassphrase={walletPassphrase} />}
      {pending && state !== "none" && <UpgradeBanner state={state} pending={pending} ledgerNow={ledgerNow} codePublished={code.data ?? null} />}
      {info.data?.info?.paused && <PausedBanner />}
      {migrationPending && (
        <MigrationCard
          canRun={!!address}
          busy={tx.busy}
          onRun={() => void tx.run({ key: "migrate", label: "Run the migration", job: { kind: "invoke", method: "migrate", args: encode.none() } })}
        />
      )}
      {children}
    </>
  );
}

/** "1 hour" from upgrade_delay. */
export const noticePeriod = (seconds: number) => duration(seconds);
