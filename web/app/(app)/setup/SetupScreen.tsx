"use client";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { useReadiness } from "@/lib/hooks/queries";
import { balanceStroops, formatUsdc, toDecimalString } from "@/lib/sisonke/amount";
import { toSisonkeError, type FriendlyError } from "@/lib/sisonke/errors";
import { findUsdcPath, type UsdcPath } from "@/lib/stellar/horizon";
import { SetupStep, StepButton, type StepState } from "@/components/setup/SetupStep";
import { WalletPicker } from "@/components/setup/WalletPicker";
import { TxError } from "@/components/tx/TxError";
import { useTx } from "@/components/tx/TxProvider";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExternalIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import { WALLETS, useWallet } from "@/components/wallet/WalletProvider";

const NOTES = ["Let's go", "Nice start", "Halfway there", "One more", "All set"];
const MIN_XLM = 20_000_000n; // 2 XLM
const SWAP_USDC = "10.0000000";
const MAX_XLM = 1_000_000_000n; // 100 XLM

type Quote = { kind: "loading" } | { kind: "ready"; path: UsdcPath; quote: bigint; sendMax: bigint } | { kind: "none" } | { kind: "tooDear"; quote: bigint } | { kind: "error"; message: string };

const statusOf = (state: StepState, busyText = "Working…") =>
  state === "done" ? "Done" : state === "locked" ? "Waiting on the step above" : state === "busy" ? busyText : "Up next";

export function SetupScreen() {
  const { address, walletName, onTestnet, connecting, openConnect } = useWallet();
  const tx = useTx();
  const [friendbot, setFriendbot] = useState<"idle" | "busy" | "funded" | "error">("idle");
  const [friendbotError, setFriendbotError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [usdcCheck, setUsdcCheck] = useState<"idle" | "checking" | "none">("idle");
  const trustTx = tx.at("setup:trustline");
  const swapTx = tx.at("setup:swap");
  const waiting = friendbot === "busy" || (!!trustTx && trustTx.phase !== "done" && trustTx.phase !== "error");
  const readiness = useReadiness(address, waiting);
  const r = readiness.data;

  const s1 = !!address && onTestnet !== false;
  const xlm = balanceStroops(r?.xlm);
  const s2 = s1 && !!r?.exists && xlm >= MIN_XLM;
  const s3 = s2 && !!r?.usdc && r.usdc.authorized;
  const usdc = balanceStroops(r?.usdc?.balance);
  const s4 = s3 && usdc > 0n;
  const done = [s1, s2, s3, s4].filter(Boolean).length;

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

  async function quoteSwap() {
    setQuote({ kind: "loading" });
    try {
      const path = await findUsdcPath(SWAP_USDC);
      if (!path) return setQuote({ kind: "none" });
      const q = balanceStroops(path.sourceAmount);
      if (q === 0n || q > MAX_XLM) return setQuote({ kind: "tooDear", quote: q });
      // Generous slippage: 3× the quote, never more than 100 XLM. Bigint stroops, no float maths.
      const max = q * 3n < MAX_XLM ? q * 3n : MAX_XLM;
      setQuote({ kind: "ready", path, quote: q, sendMax: max });
    } catch (err) {
      setQuote({ kind: "error", message: toSisonkeError(err).body });
    }
  }

  async function swap() {
    if (quote?.kind !== "ready") return;
    const res = await tx.run({
      key: "setup:swap",
      label: "Swap XLM for 10 USDC",
      job: { kind: "swap", destAmount: SWAP_USDC, sendMax: toDecimalString(quote.sendMax), path: quote.path.path },
    });
    if (res) setQuote(null);
  }

  async function checkUsdc() {
    setUsdcCheck("checking");
    const next = await readiness.refetch();
    setUsdcCheck(balanceStroops(next.data?.usdc?.balance) > 0n ? "idle" : "none");
  }

  const st1: StepState = s1 ? "done" : connecting ? "busy" : "next";
  const st2: StepState = s2 ? "done" : !s1 ? "locked" : friendbot === "busy" ? "busy" : "next";
  const trustBusy = !!trustTx && trustTx.phase !== "done" && trustTx.phase !== "error";
  const st3: StepState = s3 ? "done" : !s2 ? "locked" : trustBusy ? "busy" : "next";
  const swapBusy = !!swapTx && swapTx.phase !== "done" && swapTx.phase !== "error";
  const st4: StepState = s4 ? "done" : !s3 ? "locked" : swapBusy ? "busy" : "next";

  const trustLabel =
    trustTx?.phase === "signing" ? "Approve in your wallet…" : trustTx?.phase === "submitting" || trustTx?.phase === "confirming" ? "Sending to Stellar…" : "Checking…";

  return (
    <main id="main" className="mx-auto flex max-w-[1240px] flex-col gap-9 px-4 pt-12 pb-24 min-[720px]:px-6">
      <div className="rise flex flex-wrap items-end justify-between gap-x-12 gap-y-6" style={{ animationDelay: "80ms" }}>
        <div className="flex flex-col gap-[18px]">
          <h1 className="display m-0 flex flex-col items-start leading-[0.95]">
            <span className="inline-block bg-ink px-5 pt-3 pb-4 text-[clamp(40px,5vw,68px)] text-on-ink">Get set up.</span>
          </h1>
          <p className="m-0 max-w-[22em] font-serif text-[clamp(24px,2.6vw,32px)] leading-[1.2]">
            Four quick steps, once. Then every escrow is two taps away.
          </p>
        </div>
        <div className="flex flex-[0_1_320px] flex-col gap-2.5">
          <div className="flex justify-between text-sm font-semibold">
            <span>{done} of 4 done</span>
            <span className="text-muted">{NOTES[done]}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done} aria-label="Setup progress" className="h-3 overflow-hidden rounded-pill bg-sand">
            <div
              className="h-full rounded-pill bg-lime shadow-[inset_0_0_0_1.5px_var(--color-ink)] transition-[width] duration-[600ms] ease-[var(--ease-rise)]"
              style={{ width: `${done * 25}%` }}
            />
          </div>
        </div>
      </div>

      {done === 4 && (
        <div className="slidein flex flex-wrap items-center justify-between gap-x-8 gap-y-5 rounded-panel bg-ink px-8 py-7 text-on-ink">
          <div className="flex flex-col gap-1.5">
            <span className="display text-[40px]">You&apos;re ready.</span>
            <span className="text-base text-on-ink-muted">Your wallet can hold USDC and pay fees. Time to make a deal.</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/new" className="display lift inline-flex min-h-14 items-center rounded-pill bg-lime px-7 text-[22px] text-ink no-underline hover:text-ink">
              Start an escrow
            </Link>
            <Link href="/dashboard" className="text-[15px] font-semibold text-on-ink underline-offset-[5px] hover:text-lime">
              Go to my escrows
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-7">
        <ol className="m-0 flex min-w-0 flex-[999_1_560px] list-none flex-col gap-3.5 p-0">
          <SetupStep n={1} title="Connect a wallet" state={st1} status={st1 === "busy" ? `Waiting for ${walletNameOf(connecting)}…` : statusOf(st1)} delay={140}>
            {s1 ? (
              <div className="slidein flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px]">
                  <span>
                    Connected with <strong>{walletName ?? "your wallet"}</strong>
                  </span>
                  <span className="rounded-pill bg-sand px-2.5 py-1 font-mono text-[13px]" title={address ?? undefined}>
                    {shortAddress(address!)}
                  </span>
                  <button
                    type="button"
                    onClick={openConnect}
                    className="min-h-11 border-0 bg-transparent px-1 text-sm font-semibold text-violet underline underline-offset-4"
                  >
                    Switch wallet
                  </button>
                </div>
                {onTestnet === null && (
                  <p className="m-0 text-[13px] text-muted">Your wallet doesn&apos;t tell apps its network. Make sure it&apos;s set to Testnet.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-[15px] leading-[1.55] text-muted">
                  Pick the Stellar wallet you use. Sisonke never sees your keys. You approve every step there.
                </p>
                {address && onTestnet === false && (
                  <Notice tone="error" role="alert">
                    Your wallet is on another network. Switch it to Testnet, then reconnect.
                  </Notice>
                )}
                <WalletPicker variant="grid" />
              </div>
            )}
          </SetupStep>

          <SetupStep n={2} title="Get test XLM" state={st2} status={statusOf(st2)} delay={200}>
            <p className="m-0 text-[15px] leading-[1.55] text-muted">XLM pays Stellar&apos;s tiny network fees. On Testnet, Friendbot gives it out for free.</p>
            {s2 ? (
              <span className="slidein text-[15px]">
                {friendbot === "funded" ? (
                  <>
                    <strong>10,000 test XLM</strong> added. Plenty for fees.
                  </>
                ) : (
                  <>
                    Your wallet has <strong>{formatUsdc((xlm / 100_000n) * 100_000n)} test XLM</strong>. Plenty for fees.
                  </>
                )}
              </span>
            ) : (
              <>
                <StepButton onClick={() => void getXlm()} disabled={!s1} busy={friendbot === "busy"}>
                  {friendbot === "busy" ? "Asking Friendbot…" : !s1 ? "Connect a wallet first" : "Get test XLM"}
                </StepButton>
                {friendbot === "error" && friendbotError && (
                  <p role="alert" className="slidein m-0 text-[13px] font-semibold text-error">
                    Friendbot didn&apos;t answer: {friendbotError}
                  </p>
                )}
              </>
            )}
          </SetupStep>

          <SetupStep n={3} title="Add a USDC trustline" state={st3} status={statusOf(st3)} delay={260}>
            <p className="m-0 text-[15px] leading-[1.55] text-muted">
              Stellar wallets only hold tokens you choose to trust. One signature lets yours hold USDC.
            </p>
            {s3 ? (
              <span className="slidein text-[15px]">
                <strong>USDC trustline</strong> added to your wallet.
              </span>
            ) : r?.usdc && !r.usdc.authorized ? (
              <Notice tone="error">Circle has frozen USDC on this wallet, so it can&apos;t hold or send it. Use another wallet.</Notice>
            ) : trustTx?.phase === "error" && trustTx.error ? (
              <TxError error={trustTx.error} onRetry={() => tx.clear("setup:trustline")} />
            ) : (
              <StepButton
                onClick={() => void tx.run({ key: "setup:trustline", label: "Add a USDC trustline", job: { kind: "trustline" } })}
                disabled={!s2 || (tx.busy && !trustBusy)}
                busy={trustBusy}
              >
                {trustBusy ? trustLabel : !s2 ? "Get XLM first" : "Add trustline"}
              </StepButton>
            )}
          </SetupStep>

          <SetupStep n={4} title="Get test USDC" state={st4} status={statusOf(st4, "Swapping on the Testnet DEX…")} delay={320}>
            <p className="m-0 text-[15px] leading-[1.55] text-muted">
              Circle&apos;s faucet sends free testnet USDC to your address. Choose Stellar there, paste your address, done.
            </p>
            {s4 ? (
              <span className="slidein text-[15px]">
                <strong>Test USDC</strong> is in your wallet.
              </span>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
                  <a
                    href={config.usdcFaucetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!s3 || undefined}
                    tabIndex={s3 ? undefined : -1}
                    onClick={(e) => !s3 && e.preventDefault()}
                    className={cn(
                      "inline-flex min-h-12 items-center gap-2 rounded-pill px-[22px] text-[15px] font-bold no-underline",
                      s3 ? "bg-lime text-ink hover:text-ink" : "pointer-events-none bg-sand text-faint",
                    )}
                  >
                    Open Circle&apos;s faucet <ExternalIcon />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  {address && s3 && <CopyButton value={address} label="Copy my address" done="Address copied" variant="outline" size="md" />}
                  <button
                    type="button"
                    onClick={() => s3 && void checkUsdc()}
                    aria-disabled={!s3 || undefined}
                    className={cn(
                      "min-h-12 rounded-pill border-[1.5px] bg-transparent px-[18px] text-[15px] font-semibold",
                      s3 ? "border-ink text-ink" : "cursor-not-allowed border-line-strong text-faint",
                    )}
                  >
                    {usdcCheck === "checking" ? "Checking…" : "I've got my USDC"}
                  </button>
                </div>
                {usdcCheck === "none" && (
                  <p role="status" className="slidein m-0 text-[13px] font-semibold text-muted">
                    No USDC yet. Circle&apos;s faucet can take a minute.
                  </p>
                )}
                {s3 && (
                  <div className="flex flex-col gap-2.5 border-t border-sand pt-3">
                    <span className="text-sm text-muted">Or buy 10 test USDC with test XLM on the Testnet DEX:</span>
                    {swapTx?.phase === "error" && swapTx.error ? (
                      <SwapError error={swapTx.error} onRetry={() => tx.clear("setup:swap")} />
                    ) : swapBusy ? (
                      <StepButton onClick={() => undefined} busy>
                        {swapTx?.phase === "signing" ? "Approve in your wallet…" : "Swapping on the Testnet DEX…"}
                      </StepButton>
                    ) : quote?.kind === "ready" ? (
                      <div className="slidein flex flex-col gap-2.5">
                        <p className="m-0 text-[15px]">
                          About <strong className="tabular">{formatUsdc(quote.quote, { min: 0 })} XLM</strong>, at most{" "}
                          <strong className="tabular">{formatUsdc(quote.sendMax, { min: 0 })} XLM</strong>.
                        </p>
                        <div className="flex flex-wrap gap-2.5">
                          <StepButton onClick={() => void swap()} disabled={tx.busy}>
                            Swap now
                          </StepButton>
                          <button type="button" onClick={() => setQuote(null)} className="min-h-12 rounded-pill border-[1.5px] border-ink bg-transparent px-[18px] text-[15px] font-semibold">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void quoteSwap()}
                          aria-disabled={quote?.kind === "loading" || undefined}
                          className="min-h-12 self-start rounded-pill border-[1.5px] border-ink bg-card px-[18px] text-[15px] font-bold"
                        >
                          {quote?.kind === "loading" ? "Asking the DEX…" : "Swap XLM for 10 USDC"}
                        </button>
                        {quote?.kind === "none" && (
                          <p role="status" className="slidein m-0 text-[13px] font-semibold text-muted">
                            The Testnet DEX has no XLM → USDC offers right now. Use Circle&apos;s faucet.
                          </p>
                        )}
                        {quote?.kind === "tooDear" && (
                          <p role="status" className="slidein m-0 text-[13px] font-semibold text-muted">
                            The DEX wants {formatUsdc(quote.quote, { min: 0 })} XLM for 10 USDC, more than 100 XLM. Use Circle&apos;s faucet.
                          </p>
                        )}
                        {quote?.kind === "error" && (
                          <p role="alert" className="slidein m-0 text-[13px] font-semibold text-error">
                            {quote.message}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </SetupStep>
        </ol>

        <aside aria-label="Help" className="rise flex min-w-0 flex-[1_1_340px] flex-col gap-3.5" style={{ animationDelay: "240ms" }}>
          <div className="flex flex-col gap-4 rounded-[24px] bg-ink p-7 text-on-ink">
            <h2 className="m-0 font-serif text-[34px] font-normal leading-[1.05]">Why four steps?</h2>
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-[15px] leading-[1.55] text-on-ink-muted">
              {[
                "Your wallet is your account. Nothing to sign up for, nothing for us to lose.",
                "XLM covers fees, and the trustline lets your wallet hold USDC.",
                "Everything here is Testnet money. Free to get, and worth nothing outside testing.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-pill bg-lime" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2 rounded-[24px] bg-sand px-6 py-[22px]">
            <span className="text-base font-bold">Already set up?</span>
            <span className="text-[15px] leading-normal text-muted">Skip straight to your escrows, or read exactly what the contract allows.</span>
            <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 pt-1 text-[15px] font-semibold">
              <Link href="/dashboard" className="inline-flex min-h-11 items-center underline-offset-4">
                My escrows
              </Link>
              <Link href="/rules" className="inline-flex min-h-11 items-center underline-offset-4">
                The rules
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function SwapError({ error, onRetry }: { error: FriendlyError; onRetry: () => void }) {
  return <TxError error={error} onRetry={onRetry} />;
}

function walletNameOf(id: string | null) {
  return WALLETS.find((w) => w.id === id)?.name ?? "your wallet";
}
