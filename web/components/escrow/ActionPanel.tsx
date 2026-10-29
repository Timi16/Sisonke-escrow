"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { duration, formatWhen, shortAddress } from "@/lib/format";
import { useReadiness, useTrust } from "@/lib/hooks/queries";
import type { ActionId, Actions } from "@/lib/sisonke/actions";
import { balanceStroops, formatUsdc } from "@/lib/sisonke/amount";
import { encode } from "@/lib/sisonke/contract";
import { actionDescription, actionLabel, cardHeading } from "@/lib/sisonke/copy";
import { readHidden, writeHidden } from "@/lib/sisonke/hidden";
import { aloneNow, upgradeNotice } from "@/lib/sisonke/notices";
import { isFinal, type ContractInfo, type EscrowView, type Role } from "@/lib/sisonke/types";
import type { Readiness } from "@/lib/stellar/horizon";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EyeIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import { TxError } from "@/components/tx/TxError";
import { TxProgress } from "@/components/tx/TxProgress";
import { useTx } from "@/components/tx/TxProvider";
import { TxResult } from "@/components/tx/TxResult";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ResolveForm } from "./ResolveForm";

/** Can this wallet receive USDC? Null while unknown. */
function canReceive(r: Readiness | undefined): boolean | null {
  if (!r) return null;
  return r.exists && !!r.usdc && r.usdc.authorized;
}

function GuestCard() {
  const { openConnect } = useWallet();
  return (
    <div className="slidein flex flex-col gap-4">
      <span className="inline-flex min-h-[30px] items-center gap-2 self-start rounded-pill bg-sand px-3 text-[13px] font-bold">
        <EyeIcon />
        View only
      </span>
      <h2 className="m-0 font-serif text-[30px] font-normal leading-none min-[720px]:text-[34px]">Connect to act</h2>
      <p className="m-0 text-[15px] leading-[1.55] text-muted">
        Anyone with this link can watch the escrow. To deposit, release or refund, connect the wallet that&apos;s part of it. The contract will
        recognise it.
      </p>
      <Button variant="primary" size="lg" onClick={openConnect}>
        Connect wallet
      </Button>
      <p className="m-0 text-[13px] text-muted">
        New to Stellar?{" "}
        <Link href="/setup" className="font-bold underline-offset-4">
          Set up in four steps
        </Link>
      </p>
    </div>
  );
}

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

/** The action card: guest, actions, inline transaction progress, or the error block. */
export function ActionPanel({
  view,
  role,
  actions,
  info,
  ledgerNow,
}: {
  view: EscrowView;
  role: Role;
  actions: Actions;
  info: ContractInfo | null;
  ledgerNow: number | null;
}) {
  const e = view.escrow;
  const id = e.id.toString();
  const key = `escrow:${id}`;
  const { address, walletName, onTestnet } = useWallet();
  const tx = useTx();
  const mine = tx.at(key);
  const has = (a: ActionId) => actions.allowed.includes(a);
  const readiness = useReadiness(role === "payer" && has("fund") ? address : null);
  const recipientTrust = useTrust(has("release") || has("resolve") ? e.recipient : null);
  const payerTrust = useTrust(has("refund") || has("reclaim") || has("resolve") ? e.payer : null);

  const run = (a: ActionId, recipientAmount?: bigint) => {
    if (!address) return;
    const args =
      a === "dispute" ? encode.dispute(e.id, address) : a === "resolve" ? encode.resolve(e.id, recipientAmount ?? 0n) : encode.id(e.id);
    void tx.run({ key, label: actionLabel(a, e), job: { kind: "invoke", method: a, args }, escrow: e, amount: a === "fund" ? e.amount : undefined });
  };

  let body: ReactNode;
  if (role === "guest") {
    body = <GuestCard />;
  } else if (mine?.phase === "error" && mine.error) {
    body = (
      <TxError
        error={mine.error}
        onRetry={() => tx.clear(key)}
        onFix={(fix) =>
          fix === "migrate" &&
          void tx.run({ key, label: "Run the migration", job: { kind: "invoke", method: "migrate", args: encode.none() } })
        }
      />
    );
  } else if (mine) {
    body = (
      <div className="flex flex-col gap-4">
        <TxProgress tx={mine} walletName={walletName} source={address} />
        {mine.phase === "done" && mine.result && <TxResult result={mine.result} onDone={() => tx.clear(key)} />}
      </div>
    );
  } else {
    const h = cardHeading(e, role, view.deadlinePassed);
    const wrongNetwork = onTestnet === false;
    const otherBusy = tx.busy;
    const disabled = wrongNetwork || otherBusy;
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
          The payer picked this arbiter. If you don&apos;t know and trust them, don&apos;t start work: they can decide a dispute for the payer. You can
          refund to step out.
        </Notice>,
      );
    }
    // Payer before depositing: the upgrade-delay note (INTEGRATION §2).
    if (role === "payer" && e.status === "Created" && !view.deadlinePassed && info && ledgerNow !== null && e.deadline - ledgerNow > info.upgradeDelay) {
      notes.push(
        <Notice key="delay">
          This contract&apos;s code can be upgraded after a public {duration(info.upgradeDelay)} notice. If that ever happens before {deadlineText}, you could
          only get your money back early through {shortAddress(e.recipient)}&apos;s refund{e.arbiter ? ", or the arbiter" : ""}. Pick a shorter deadline if you
          want to be able to leave on your own.
        </Notice>,
      );
    }
    // Your own deposit (board "Heads up").
    if (has("fund") && readiness.data) {
      const line = readiness.data.usdc;
      const have = balanceStroops(line?.balance);
      if (!line)
        notes.push(
          <Notice key="fund">
            Heads up: your wallet can&apos;t hold USDC yet. It needs a USDC trustline.{" "}
            <Link href="/setup" className="font-bold text-violet underline-offset-[3px]">
              Fix it in setup
            </Link>
          </Notice>,
        );
      else if (have < e.amount)
        notes.push(
          <Notice key="fund">
            Heads up: your wallet has {formatUsdc(have)} USDC. This deposit needs {formatUsdc(e.amount)}.{" "}
            <Link href="/setup" className="font-bold text-violet underline-offset-[3px]">
              Fix it in setup
            </Link>
          </Notice>,
        );
    }
    // The receiving side must be able to hold USDC (INTEGRATION §8).
    const recipientOk = canReceive(recipientTrust.data);
    const payerOk = canReceive(payerTrust.data);
    if ((has("release") || has("resolve")) && recipientOk === false) {
      notes.push(
        <Notice key="rtrust">
          The recipient&apos;s wallet can&apos;t receive USDC yet, so a {has("release") ? "release" : "decision paying them"} would fail. Ask them to add USDC in Sisonke setup.
        </Notice>,
      );
    }
    if ((has("refund") || has("reclaim") || has("resolve")) && payerOk === false) {
      notes.push(
        <Notice key="ptrust">
          {role === "payer" ? "Your wallet" : "The payer's wallet"} can&apos;t receive USDC yet, so {has("reclaim") ? "a reclaim" : has("refund") ? "a refund" : "a decision paying them"} would fail.{" "}
          {role === "payer" ? (
            <Link href="/setup" className="font-bold text-violet underline-offset-[3px]">
              Fix it in setup
            </Link>
          ) : (
            "Ask them to add USDC in Sisonke setup."
          )}
        </Notice>,
      );
    }

    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 font-serif text-[30px] font-normal leading-none min-[720px]:text-[34px]">{h.heading}</h2>
          <p className="m-0 text-sm leading-normal text-muted min-[720px]:text-[15px]">{h.intro}</p>
        </div>
        {notes}
        {actions.allowed.map((a) =>
          a === "resolve" ? (
            <ResolveForm
              key={a}
              escrow={e}
              disabled={disabled}
              disabledNote={wrongNetwork ? "Switch your wallet to Testnet to sign." : undefined}
              onSubmit={(r) => run("resolve", r)}
            />
          ) : (
            <div key={a} className="flex flex-col gap-2">
              <Button variant={actions.primary.includes(a) ? "primary" : "outline"} size={actions.primary.includes(a) ? "lg" : "md"} className={actions.primary.includes(a) ? undefined : "w-full !min-h-[50px]"} disabled={disabled} onClick={() => run(a)}>
                {actionLabel(a, e)}
              </Button>
              <p className="m-0 text-xs leading-normal text-muted min-[720px]:text-[13px]">
                {wrongNetwork ? "Switch your wallet to Testnet to sign." : actionDescription(a, e)}
              </p>
            </div>
          ),
        )}
        {isFinal(e.status) && (
          <ButtonLink href="/new" variant="outline" className="w-full !min-h-[50px]">
            Start another escrow
          </ButtonLink>
        )}
        {address && (role === "recipient" || role === "arbiter") && <HideToggle id={id} me={address} />}
      </div>
    );
  }

  return (
    <section aria-label="Actions" className="flex flex-col gap-[18px] rounded-[24px] border-[1.5px] border-ink bg-card p-5 shadow-action min-[720px]:rounded-card min-[720px]:p-[26px]">
      {body}
    </section>
  );
}
