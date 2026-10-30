"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { duration, formatWhen, shortAddress } from "@/lib/format";
import { useReadiness, useTrust } from "@/lib/hooks/queries";
import type { ActionId, Actions } from "@/lib/sisonke/actions";
import { balanceStroops, formatUsdc } from "@/lib/sisonke/amount";
import { encode } from "@/lib/sisonke/contract";
import { actionDescription, actionLabel, cardHeading, confirmOf } from "@/lib/sisonke/copy";
import { readHidden, writeHidden } from "@/lib/sisonke/hidden";
import { aloneNow, upgradeNotice } from "@/lib/sisonke/notices";
import { isFinal, type ContractInfo, type EscrowView, type Role } from "@/lib/sisonke/types";
import type { Readiness } from "@/lib/stellar/horizon";
import { Notice } from "@/components/ui/Notice";
import { TxError } from "@/components/tx/TxError";
import { TxSteps } from "@/components/tx/TxSteps";
import { useTx } from "@/components/tx/TxProvider";
import { TxResult } from "@/components/tx/TxResult";
import { useWallet } from "@/components/wallet/WalletProvider";
import { SplitPicker } from "./SplitPicker";

/** Can this wallet receive USDC? Null while unknown. */
function canReceive(r: Readiness | undefined): boolean | null {
  if (!r) return null;
  return r.exists && !!r.usdc && r.usdc.authorized;
}

/** The solid lime button is for moves that pay out or lock money; the rest are outlined. */
const SOLID: ActionId[] = ["fund", "release", "reclaim"];

function HideToggle({ id, me }: { id: string; me: string }) {
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? false : readHidden(me).has(id)));
  return (
    <button
      type="button"
      onClick={() => {
        const set = readHidden(me);
        if (hidden) set.delete(id);
        else set.add(id);
        writeHidden(me, set);
        setHidden(!hidden);
      }}
      className="min-h-11 self-start px-0.5 text-[13px] font-semibold text-muted underline underline-offset-4"
    >
      {hidden ? "Hidden from your list. Show it again" : "Hide from my list"}
    </button>
  );
}

const fix = (
  <Link href="/setup" className="font-bold text-violet underline-offset-[3px]">
    Fix it in Test funds
  </Link>
);

/** "Your move": what the action matrix allows this wallet, a confirm step, then the wallet. */
export function MoveCard({ view, role, actions, info, ledgerNow }: { view: EscrowView; role: Role; actions: Actions; info: ContractInfo | null; ledgerNow: number | null }) {
  const e = view.escrow;
  const id = e.id.toString();
  const key = `escrow:${id}`;
  const { address, walletName, onTestnet, openConnect } = useWallet();
  const tx = useTx();
  const mine = tx.at(key);
  const [ask, setAsk] = useState<{ action: ActionId; share?: bigint } | null>(null);
  const has = (a: ActionId) => actions.allowed.includes(a);
  const readiness = useReadiness(role === "payer" && has("fund") ? address : null);
  const recipientTrust = useTrust(has("release") || has("resolve") ? e.recipient : null);
  const payerTrust = useTrust(has("refund") || has("reclaim") || has("resolve") ? e.payer : null);
  const h = cardHeading(e, role, view.deadlinePassed);

  const run = (a: ActionId, share?: bigint) => {
    if (!address) return;
    setAsk(null);
    const args = a === "dispute" ? encode.dispute(e.id, address) : a === "resolve" ? encode.resolve(e.id, share ?? 0n) : encode.id(e.id);
    void tx.run({ key, label: actionLabel(a, e), job: { kind: "invoke", method: a, args }, escrow: e, amount: a === "fund" ? e.amount : undefined });
  };

  let body: ReactNode;
  if (mine?.phase === "error" && mine.error) {
    body = (
      <TxError
        error={mine.error}
        onRetry={() => tx.clear(key)}
        onFix={(f) => f === "migrate" && void tx.run({ key, label: "Run the migration", job: { kind: "invoke", method: "migrate", args: encode.none() } })}
      />
    );
  } else if (mine) {
    body = (
      <div className="flex flex-col gap-3.5">
        <TxSteps tx={mine} walletName={walletName} />
        {mine.phase === "done" && mine.result && <TxResult result={mine.result} onDone={() => tx.clear(key)} />}
      </div>
    );
  } else if (role === "guest") {
    body = !isFinal(e.status) && (
      <button type="button" onClick={() => openConnect("act")} className="display lift-app min-h-[52px] rounded-pill border-0 bg-lime text-[17px] text-ink">
        Connect wallet
      </button>
    );
  } else {
    const wrongNetwork = onTestnet === false;
    const disabled = wrongNetwork || tx.busy;
    const notes: ReactNode[] = [];
    const deadlineText = formatWhen(e.deadline);

    // Upgrade pending: what the viewer can do alone, right now (WEB_PLAN §6.7).
    const upgrade = upgradeNotice(info, ledgerNow);
    if ((upgrade === "beforeEta" || upgrade === "live") && !isFinal(e.status)) {
      const alone = aloneNow(role, e.status, view.deadlinePassed, deadlineText);
      if (alone)
        notes.push(
          <Notice key="alone">
            <strong>What you can do alone, right now:</strong> {alone} Ask the other side to settle with you.
          </Notice>,
        );
    }
    // Recipient: the payer chose the arbiter (INTEGRATION §6).
    if (role === "recipient" && e.arbiter && !isFinal(e.status)) {
      notes.push(
        <Notice key="arbiter">
          The payer picked this arbiter. If you don&apos;t know and trust them, don&apos;t start work: they can decide a dispute for the payer. You can refund to step out.
        </Notice>,
      );
    }
    // Payer before depositing: the upgrade-delay note (INTEGRATION §2).
    if (role === "payer" && e.status === "Created" && !view.deadlinePassed && info && !info.upgradesLocked && ledgerNow !== null && e.deadline - ledgerNow > info.upgradeDelay) {
      notes.push(
        <Notice key="delay">
          The code can be upgraded after a public {duration(info.upgradeDelay)} notice. If that happens before {deadlineText}, only {shortAddress(e.recipient)}&apos;s refund
          {e.arbiter ? " or the arbiter" : ""} could return your money early.
        </Notice>,
      );
    }
    // Your own deposit.
    if (has("fund") && readiness.data) {
      const line = readiness.data.usdc;
      const have = balanceStroops(line?.balance);
      if (!line)
        notes.push(
          <Notice key="fund">
            Heads up: your wallet can&apos;t hold USDC yet. It needs a USDC trustline. {fix}
          </Notice>,
        );
      else if (have < e.amount)
        notes.push(
          <Notice key="fund">
            Heads up: your wallet has {formatUsdc(have)} USDC. This deposit needs {formatUsdc(e.amount)}. {fix}
          </Notice>,
        );
    }
    // The receiving side must be able to hold USDC (INTEGRATION §8).
    if ((has("release") || has("resolve")) && canReceive(recipientTrust.data) === false) {
      notes.push(
        <Notice key="rtrust">
          The recipient&apos;s wallet can&apos;t receive USDC yet, so a {has("release") ? "release" : "decision paying them"} would fail. Ask them to add USDC in Sisonke&apos;s Test funds.
        </Notice>,
      );
    }
    if ((has("refund") || has("reclaim") || has("resolve")) && canReceive(payerTrust.data) === false) {
      notes.push(
        <Notice key="ptrust">
          {role === "payer" ? "Your wallet" : "The payer's wallet"} can&apos;t receive USDC yet, so {has("reclaim") ? "a reclaim" : has("refund") ? "a refund" : "a decision paying them"} would fail.{" "}
          {role === "payer" ? fix : "Ask them to add USDC in Sisonke's Test funds."}
        </Notice>,
      );
    }

    if (ask) {
      const c = confirmOf(ask.action, e, ask.share);
      body = (
        <div className="popin flex flex-col gap-2.5 rounded-menu bg-ground p-4">
          <span className="text-[15px] font-bold leading-[1.4]">{c.question}</span>
          <span className="text-[13px] text-muted">{c.note}</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={disabled || undefined}
              onClick={() => !disabled && run(ask.action, ask.share)}
              className="min-h-[50px] flex-[1_1_140px] rounded-pill border-0 bg-ink text-sm font-extrabold text-on-ink"
            >
              {c.yes}
            </button>
            <button type="button" onClick={() => setAsk(null)} className="min-h-[50px] flex-[1_1_100px] rounded-pill border-[1.5px] border-line bg-card text-sm font-bold text-ink">
              Not yet
            </button>
          </div>
          {wrongNetwork && <span className="text-[13px] font-semibold text-error">Switch your wallet to Testnet to sign.</span>}
        </div>
      );
    } else {
      body = (
        <>
          {notes}
          {actions.allowed.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {actions.allowed.map((a) =>
                a === "resolve" ? (
                  <SplitPicker key={a} escrow={e} disabled={disabled} onAsk={(share) => setAsk({ action: "resolve", share })} />
                ) : (
                  <div key={a} className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      aria-disabled={disabled || undefined}
                      onClick={() => !disabled && setAsk({ action: a })}
                      className={cn(
                        "lift-app min-h-[52px] rounded-pill",
                        SOLID.includes(a) ? "display border-0 bg-lime text-lg text-ink" : "border-[1.5px] border-ink bg-card text-sm font-bold text-ink",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {actionLabel(a, e)}
                    </button>
                    <span className="text-[13px] leading-[1.45] text-muted">{wrongNetwork ? "Switch your wallet to Testnet to sign." : actionDescription(a, e)}</span>
                  </div>
                ),
              )}
            </div>
          )}
          {isFinal(e.status) && (
            <Link href="/new" className="lift-app inline-flex min-h-12 items-center justify-center rounded-pill border-[1.5px] border-ink bg-card text-sm font-bold text-ink no-underline hover:text-ink">
              Start another escrow
            </Link>
          )}
          {address && (role === "recipient" || role === "arbiter") && <HideToggle id={id} me={address} />}
        </>
      );
    }
  }

  return (
    <section aria-labelledby="move-h" aria-live="polite" className="rise flex flex-col gap-3.5 rounded-panel border-2 border-ink bg-card p-[22px] shadow-action" style={{ animationDelay: "120ms" }}>
      <h2 id="move-h" className="m-0 font-serif text-2xl font-normal leading-none">
        {mine ? mine.label : h.heading}
      </h2>
      {!mine && <p className="m-0 text-sm leading-normal text-muted">{h.intro}</p>}
      {body}
    </section>
  );
}
