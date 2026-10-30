"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { useReadiness } from "@/lib/hooks/queries";
import { balanceStroops, formatUsdc, toDecimalString } from "@/lib/sisonke/amount";
import { toSisonkeError } from "@/lib/sisonke/errors";
import { SWAP_CHOICES, planSwap, usdcAmount, type SwapChoice } from "@/lib/sisonke/funds";
import { findUsdcPath } from "@/lib/stellar/horizon";
import { PageHead } from "@/components/app/PageHead";
import { TxError } from "@/components/tx/TxError";
import { useTx } from "@/components/tx/TxProvider";
import { ArrowIcon, CheckIcon, InkSpinner } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import { WALLETS, useWallet } from "@/components/wallet/WalletProvider";

const MIN_XLM = 20_000_000n; // 2 XLM
type Look = "done" | "current" | "locked";

/** Whole XLM, grouped: "9,998.70". */
const xlmText = (stroops: bigint) => formatUsdc((stroops / 100_000n) * 100_000n);

function Step({
  n,
  look,
  title,
  text,
  extra,
  action,
  busy,
  doneText,
}: {
  n: number;
  look: Look;
  title: string;
  text: ReactNode;
  extra?: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  busy?: string | null;
  doneText: ReactNode;
}) {
  const done = look === "done";
  const current = look === "current";
  return (
    <li
      aria-labelledby={`step-${n}`}
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-3.5 rounded-[24px] px-[22px] py-5 transition-opacity duration-300",
        done ? "bg-sand" : current ? "border-2 border-ink bg-card shadow-action" : "border border-line bg-card opacity-55",
      )}
    >
      <span
        className={cn(
          "display flex size-12 shrink-0 items-center justify-center rounded-pill text-[17px]",
          done ? "bg-lime text-ink" : current ? "bg-ink text-lime" : "border-[1.5px] border-switch-off text-faint",
        )}
      >
        {done ? <CheckIcon size={22} className="pop-strong" /> : n}
        <span className="sr-only">{done ? ` Step ${n} done` : current ? ` Step ${n}, up next` : ` Step ${n}, waiting on the step above`}</span>
      </span>
      <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-1">
        <h2 id={`step-${n}`} className="m-0 text-base font-extrabold">
          {title}
        </h2>
        <span className="text-sm leading-normal text-muted">{text}</span>
        {extra}
      </div>
      {done ? (
        <span className="flex-[1_1_180px] text-right text-sm font-bold text-ok">{doneText}</span>
      ) : busy ? (
        <span aria-live="polite" className="inline-flex min-h-[52px] flex-[1_1_180px] items-center justify-center gap-2.5 rounded-pill bg-ink px-[22px] text-sm font-bold text-on-ink">
          <InkSpinner size={18} />
          {busy}
        </span>
      ) : current && action ? (
        <button
          type="button"
          onClick={action.disabled ? undefined : action.onClick}
          aria-disabled={action.disabled || undefined}
          className={cn("lift-app min-h-[52px] flex-[1_1_180px] rounded-pill border-0 bg-ink px-[22px] text-sm font-extrabold text-on-ink", action.disabled && "cursor-not-allowed opacity-60")}
        >
          {action.label}
        </button>
      ) : null}
    </li>
  );
}

/** Free Testnet XLM and USDC in four steps (docs/design/app test-funds board). */
export function SetupScreen() {
  const { address, walletName, onTestnet, connecting, openConnect } = useWallet();
  const tx = useTx();
  const [friendbot, setFriendbot] = useState<"idle" | "busy" | "funded" | "error">("idle");
  const [friendbotError, setFriendbotError] = useState<string | null>(null);
  const [usdcCheck, setUsdcCheck] = useState<"idle" | "checking" | "none">("idle");
  const [choice, setChoice] = useState<SwapChoice>(100);
  const [more, setMore] = useState(false);
  const trustTx = tx.at("setup:trustline");
  const swapTx = tx.at("setup:swap");
  const trustBusy = !!trustTx && trustTx.phase !== "done" && trustTx.phase !== "error";
  const swapBusy = !!swapTx && swapTx.phase !== "done" && swapTx.phase !== "error";
  const readiness = useReadiness(address, friendbot === "busy" || trustBusy);
  const r = readiness.data;

  const s1 = !!address && onTestnet !== false;
  const xlm = balanceStroops(r?.xlm);
  const s2 = s1 && !!r?.exists && xlm >= MIN_XLM;
  const s3 = s2 && !!r?.usdc && r.usdc.authorized;
  const usdc = balanceStroops(r?.usdc?.balance);
  const s4 = s3 && usdc > 0n;
  const swapOpen = s3 && (!s4 || more);

  const quote = useQuery({
    queryKey: ["usdcQuote", choice],
    queryFn: () => findUsdcPath(usdcAmount(choice)),
    enabled: swapOpen && !swapBusy,
    staleTime: 30_000,
    retry: 1,
  });
  const path = quote.data ?? null;
  const plan = path ? planSwap(balanceStroops(path.sourceAmount), choice, xlm) : null;

  async function getXlm() {
    if (!address) return;
    setFriendbot("busy");
    setFriendbotError(null);
    try {
      const res = await fetch("/api/friendbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = (await res.json().catch(() => ({}))) as { funded?: boolean; alreadyFunded?: boolean; error?: { message?: string } };
      if (!res.ok || !data.funded) throw new Error(data.error?.message ?? `Friendbot answered ${res.status}`);
      // Poll readiness until the account exists (the query polls every 5 s while busy).
      for (let i = 0; i < 12; i++) {
        const next = await readiness.refetch();
        if (next.data?.exists) break;
        await new Promise((ok) => setTimeout(ok, 5000));
      }
      setFriendbot(data.alreadyFunded ? "idle" : "funded");
    } catch (err) {
      setFriendbot("error");
      setFriendbotError(toSisonkeError(err).body);
    }
  }

  async function swap() {
    if (!path || plan?.kind !== "ok") return;
    const res = await tx.run({
      key: "setup:swap",
      label: `Swap XLM for ${choice} USDC`,
      job: { kind: "swap", destAmount: usdcAmount(choice), sendMax: toDecimalString(plan.sendMax), path: path.path },
    });
    if (res) {
      setMore(false);
      void quote.refetch();
    }
  }

  async function checkUsdc() {
    setUsdcCheck("checking");
    const next = await readiness.refetch();
    setUsdcCheck(balanceStroops(next.data?.usdc?.balance) > 0n ? "idle" : "none");
  }

  const states = [s1, s2, s3, s4];
  const firstOpen = states.findIndex((s) => !s);
  const look = (i: number): Look => (states[i] && !(i === 3 && more) ? "done" : i === firstOpen || (i === 3 && more) ? "current" : "locked");
  const signing = (t: typeof trustTx) => (t?.phase === "signing" ? "Approve in your wallet…" : t?.phase === "checking" ? "Checking…" : "Sending to Stellar…");

  const swapText: ReactNode =
    quote.isFetching && !path ? (
      "Asking the Testnet DEX for a price…"
    ) : quote.isError ? (
      toSisonkeError(quote.error).body
    ) : quote.data === null ? (
      "The Testnet DEX has no XLM → USDC offers right now. Use Circle’s faucet below."
    ) : plan?.kind === "tooDear" ? (
      `The DEX wants ${formatUsdc(plan.quote, { min: 0 })} XLM, more than 10 XLM per USDC. Pick less, or use Circle’s faucet.`
    ) : plan?.kind === "short" ? (
      `Costs ≈ ${xlmText(plan.quote)} XLM, more than the ${xlmText(plan.spendable)} XLM you can spend. Pick less.`
    ) : plan ? (
      <>
        Costs ≈ <strong className="tabular text-ink">{xlmText(plan.quote)} XLM</strong> on the Testnet DEX.
      </>
    ) : (
      "Buys test USDC with test XLM on the Testnet DEX."
    );

  const ready = s4 && !more;
  const walletBusy = connecting ? `Waiting for ${WALLETS.find((w) => w.id === connecting)?.name ?? "your wallet"}…` : null;

  return (
    <main id="main" className="flex flex-col gap-[22px]">
      <PageHead title="Test funds" sub="Free Testnet XLM and USDC." />
      <ol className="rise m-0 flex list-none flex-col gap-2.5 p-0" style={{ animationDelay: "140ms" }}>
        <Step
          n={1}
          look={look(0)}
          title="Connect a wallet"
          text={
            address && onTestnet === false ? (
              <span className="font-semibold text-error">Your wallet is on another network. Switch it to Testnet, then reconnect.</span>
            ) : (
              "Varial, xBull, Lobstr, Albedo or Hana."
            )
          }
          action={{ label: "Connect wallet", onClick: () => openConnect("money") }}
          busy={walletBusy}
          doneText={<>Connected{walletName ? ` with ${walletName}` : ""}</>}
        />
        <Step
          n={2}
          look={look(1)}
          title="Get test XLM"
          text={
            <>
              For network fees. No signature needed.
              {friendbot === "error" && friendbotError && (
                <span role="alert" className="mt-1 block font-semibold text-error">
                  Friendbot didn&apos;t answer: {friendbotError}
                </span>
              )}
            </>
          }
          action={{ label: "Get 10,000 XLM", onClick: () => void getXlm() }}
          busy={friendbot === "busy" ? "Asking Friendbot…" : null}
          doneText={friendbot === "funded" ? "10,000 XLM arrived" : `${xlmText(xlm)} XLM`}
        />
        <Step
          n={3}
          look={look(2)}
          title="Enable USDC"
          text={
            <>
              Adds a USDC trustline. One signature.
              {r?.usdc && !r.usdc.authorized && (
                <span className="mt-1 block font-semibold text-error">Circle has frozen USDC on this wallet, so it can&apos;t hold or send it. Use another wallet.</span>
              )}
            </>
          }
          extra={trustTx?.phase === "error" && trustTx.error ? <TxError error={trustTx.error} onRetry={() => tx.clear("setup:trustline")} /> : undefined}
          action={
            trustTx?.phase === "error" || (r?.usdc && !r.usdc.authorized)
              ? undefined
              : { label: "Add USDC", onClick: () => void tx.run({ key: "setup:trustline", label: "Add a USDC trustline", job: { kind: "trustline" } }), disabled: tx.busy }
          }
          busy={trustBusy ? signing(trustTx) : null}
          doneText="USDC added"
        />
        <Step
          n={4}
          look={look(3)}
          title="Swap XLM for USDC"
          text={swapText}
          extra={
            <>
              {swapOpen && (
                <div role="group" aria-label="How much USDC" className="flex flex-wrap gap-2 pt-2">
                  {SWAP_CHOICES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={a === choice}
                      onClick={() => setChoice(a)}
                      className={cn("min-h-10 rounded-pill border-[1.5px] px-3.5 text-sm font-bold", a === choice ? "border-ink bg-ink text-on-ink" : "border-line bg-ground text-ink")}
                    >
                      {a} USDC
                    </button>
                  ))}
                </div>
              )}
              {swapTx?.phase === "error" && swapTx.error && (
                <div className="pt-2">
                  <TxError error={swapTx.error} onRetry={() => tx.clear("setup:swap")} />
                </div>
              )}
              {s4 && !more && (
                <button type="button" onClick={() => setMore(true)} className="min-h-9 self-start border-0 bg-transparent p-0 text-[13px] font-bold text-violet underline underline-offset-4">
                  Get more
                </button>
              )}
            </>
          }
          action={
            swapTx?.phase === "error"
              ? undefined
              : { label: `Swap for ${choice} USDC`, onClick: () => void swap(), disabled: plan?.kind !== "ok" || tx.busy }
          }
          busy={swapBusy ? (swapTx?.phase === "signing" ? "Approve in your wallet…" : "Swapping…") : null}
          doneText={`${formatUsdc(usdc)} USDC in your wallet`}
        />
      </ol>

      {ready && (
        <section className="popin flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-shell bg-ink p-[26px] text-on-ink">
          <div className="flex flex-col gap-1.5">
            <span className="display text-[29px] text-lime">You&apos;re ready.</span>
            <span className="text-[15px] text-on-ink-muted">{formatUsdc(usdc)} USDC and XLM for fees.</span>
          </div>
          <Link href="/new" className="display lift-app inline-flex min-h-[52px] items-center gap-2.5 rounded-pill bg-lime px-[30px] text-lg text-ink no-underline hover:text-ink">
            Start an escrow
            <ArrowIcon size={18} />
          </Link>
        </section>
      )}

      <div className="flex flex-col gap-2 px-1 text-sm text-muted">
        <p className="m-0">
          Or use{" "}
          <a href={config.usdcFaucetUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-ink underline-offset-4">
            Circle&apos;s faucet
          </a>{" "}
          after step 3: choose Stellar, paste your address.{" "}
          {s3 && !s4 && (
            <button type="button" onClick={() => void checkUsdc()} className="min-h-9 border-0 bg-transparent p-0 font-bold text-violet underline underline-offset-4">
              {usdcCheck === "checking" ? "Checking…" : "I've got my USDC"}
            </button>
          )}
        </p>
        {usdcCheck === "none" && (
          <Notice role="status" tone="info">
            No USDC yet. Circle&apos;s faucet can take a minute.
          </Notice>
        )}
      </div>
    </main>
  );
}
