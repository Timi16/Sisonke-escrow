"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { cn } from "@/lib/cn";
import { MAX_TITLE_BYTES } from "@/lib/config";
import { duration, formatWhen, padId, shortAddress, toLocalInput } from "@/lib/format";
import { useInfo, useReadiness } from "@/lib/hooks/queries";
import { useLedgerClock } from "@/lib/hooks/useLedgerClock";
import { checkArbiter, checkRecipient } from "@/lib/sisonke/address";
import { balanceStroops, formatUsdc, parseAmount } from "@/lib/sisonke/amount";
import { encodeCreate } from "@/lib/sisonke/contract";
import { DEFAULT_PRESET, PRESETS, customDeadline, presetDeadline, type PresetId } from "@/lib/sisonke/deadline";
import { checkTitle, titleBytes } from "@/lib/sisonke/title";
import { TxError } from "@/components/tx/TxError";
import { TxProgress } from "@/components/tx/TxProgress";
import { useTx } from "@/components/tx/TxProvider";
import { AmountInput, FieldError, Hint, Input, Label } from "@/components/ui/Field";
import { ChevronDown } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import { TxHash } from "@/components/ui/TxHash";
import { useWallet } from "@/components/wallet/WalletProvider";

interface FormValues {
  recipient: string;
  amount: string;
  preset: PresetId;
  customDeadline: string;
  title: string;
  arbiterOn: boolean;
  arbiter: string;
  lockNow: boolean;
}

interface Ctx {
  payer: string | null;
  ledgerNow: number | null;
  /** Wallet USDC in stroops, when it has a trustline. */
  balance: bigint | null;
}

const DEFAULTS: FormValues = {
  recipient: "",
  amount: "",
  preset: DEFAULT_PRESET,
  customDeadline: "",
  title: "",
  arbiterOn: false,
  arbiter: "",
  lockNow: false,
};

/** The deadline the form describes, in ledger seconds, or an error. */
function deadlineOf(v: Pick<FormValues, "preset" | "customDeadline">, ledgerNow: number | null) {
  if (ledgerNow === null) return { ok: false as const, error: "Checking Stellar's clock…" };
  if (v.preset === "custom") return customDeadline(v.customDeadline, ledgerNow);
  const p = PRESETS.find((x) => x.id === v.preset) ?? PRESETS[1];
  return { ok: true as const, deadline: presetDeadline(ledgerNow, p.days) };
}

function amountError(raw: string, balance: bigint | null): string | null {
  const a = parseAmount(raw);
  if (!a.ok) return a.error;
  if (balance !== null && a.stroops > balance) return `That's more than your balance of ${formatUsdc(balance)} USDC.`;
  return null;
}

/** One schema; its refinements call the shared validators with the live context. */
function makeSchema(c: Ctx) {
  return z
    .object({
      recipient: z.string(),
      amount: z.string(),
      preset: z.enum(["3d", "7d", "14d", "30d", "custom"]),
      customDeadline: z.string(),
      title: z.string(),
      arbiterOn: z.boolean(),
      arbiter: z.string(),
      lockNow: z.boolean(),
    })
    .superRefine((v, issue) => {
      const r = checkRecipient(v.recipient, c.payer);
      if (!r.ok) issue.addIssue({ code: "custom", path: ["recipient"], message: r.error });
      const a = amountError(v.amount, c.balance);
      if (a) issue.addIssue({ code: "custom", path: ["amount"], message: a });
      const d = deadlineOf(v, c.ledgerNow);
      if (!d.ok) issue.addIssue({ code: "custom", path: [v.preset === "custom" ? "customDeadline" : "preset"], message: d.error });
      const t = checkTitle(v.title);
      if (!t.ok) issue.addIssue({ code: "custom", path: ["title"], message: t.error });
      if (v.arbiterOn) {
        const b = checkArbiter(v.arbiter, c.payer, r.ok ? r.address : null);
        if (!b.ok) issue.addIssue({ code: "custom", path: ["arbiter"], message: b.error });
      }
    });
}

const contextResolver: Resolver<FormValues, Ctx> = (values, context, options) =>
  zodResolver(makeSchema(context ?? { payer: null, ledgerNow: null, balance: null }))(values, context, options) as ReturnType<
    Resolver<FormValues, Ctx>
  >;

function Bullet({ hollow, children }: { hollow?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className={cn("mt-2 size-2 shrink-0 rounded-pill", hollow ? "border-[1.5px] border-lime" : "bg-lime")} />
      <span>{children}</span>
    </li>
  );
}

export function NewEscrowScreen() {
  const { address, onTestnet, openConnect, walletName } = useWallet();
  const info = useInfo().data?.info ?? null;
  const readiness = useReadiness(address);
  const { ledgerNow } = useLedgerClock(1000);
  const tx = useTx();
  const state = tx.at("create");

  const usdcLine = readiness.data?.usdc ?? null;
  const balance = usdcLine ? balanceStroops(usdcLine.balance) : null;
  const form = useForm<FormValues, Ctx>({
    defaultValues: DEFAULTS,
    // RHF passes the live context to the resolver on every validation.
    context: { payer: address, ledgerNow, balance },
    resolver: contextResolver,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { register, handleSubmit, setValue, setError, clearErrors, control, reset, formState } = form;
  const errors = formState.errors;
  const v = useWatch({ control }) as FormValues;

  // Live view of the deal, from the same validators (independent of touched state).
  const rec = checkRecipient(v.recipient ?? "", address);
  const amt = parseAmount(v.amount ?? "");
  const amtOk = !amountError(v.amount ?? "", balance) && amt.ok;
  const dl = deadlineOf(v, ledgerNow);
  const titleOk = checkTitle(v.title ?? "").ok;
  const arb = v.arbiterOn ? checkArbiter(v.arbiter ?? "", address, rec.ok ? rec.address : null) : null;
  const arbOk = !v.arbiterOn || !!arb?.ok;
  const arbAddr = arb?.ok ? arb.address : null;
  const paused = !!info?.paused;
  const wrongNet = !!address && onTestnet === false;
  const ready = !!address && rec.ok && amtOk && dl.ok && titleOk && arbOk && !paused && !wrongNet;

  const amtText = amt.ok ? formatUsdc(amt.stroops) : "0.00";
  const recShort = rec.ok ? shortAddress(rec.address) : null;
  const deadlineText = dl.ok ? formatWhen(dl.deadline) : "the deadline";
  const working = !!state && state.phase !== "done" && state.phase !== "error";
  const done = state?.phase === "done" && state.result;
  // An unconfirmed create may still land: never let the form send a second one.
  const unconfirmed = state?.phase === "error" && !!state.error?.pending;
  const locked = !address || working || !!done || unconfirmed;

  const hint = !address
    ? "Connect your wallet to continue."
    : wrongNet
      ? "Switch your wallet to Testnet to sign."
      : paused
        ? "New escrows are paused right now."
        : ledgerNow === null
          ? "Checking Stellar's clock…"
          : !ready
            ? "Add a valid address and amount to continue."
            : v.lockNow
              ? "One signature creates it and locks the USDC."
              : "Two signatures: this one creates it, the next deposits.";

  const showUpgradeNote = !!info && dl.ok && ledgerNow !== null && !info.upgradesLocked && dl.deadline - ledgerNow > info.upgradeDelay;

  const onSubmit = handleSubmit(async (values) => {
    if (!address || !ready) return;
    const d = deadlineOf(values, ledgerNow);
    const a = parseAmount(values.amount);
    const r = checkRecipient(values.recipient, address);
    if (!d.ok || !a.ok || !r.ok) return;
    const arbiter = values.arbiterOn ? checkArbiter(values.arbiter, address, r.address) : null;
    const t = checkTitle(values.title);
    if (!t.ok || (arbiter && !arbiter.ok)) return;
    const method = values.lockNow ? "create_and_fund" : "create";
    await tx.run({
      key: "create",
      label: "Create escrow",
      job: {
        kind: "invoke",
        method,
        args: encodeCreate({
          payer: address,
          recipient: r.address,
          arbiter: arbiter?.ok ? arbiter.address : null,
          amount: a.stroops,
          deadline: d.deadline,
          title: t.title,
        }),
      },
      amount: values.lockNow ? a.stroops : undefined,
    });
  });

  const describe = (field: keyof FormValues, hasHint = true) =>
    errors[field] ? `${field}-error` : hasHint ? `${field}-hint` : undefined;

  const recipientReg = register("recipient");
  const arbiterReg = register("arbiter");
  /** A pasted secret key is cleared at once, never kept in the form. */
  const guardSecret = (field: "recipient" | "arbiter", value: string) => {
    const c = field === "recipient" ? checkRecipient(value, address) : checkArbiter(value, address, null);
    if (!c.ok && c.clear) {
      setValue(field, "", { shouldDirty: true });
      setError(field, { type: "secret", message: c.error });
      return true;
    }
    return false;
  };

  const bytes = titleBytes((v.title ?? "").trim());

  return (
    <main id="main" className="mx-auto flex max-w-[1240px] flex-col gap-9 px-4 pt-12 pb-24 min-[720px]:px-6">
      <div className="rise flex flex-col gap-4" style={{ animationDelay: "60ms" }}>
        <h1 className="display m-0 flex items-start leading-[0.95]">
          <span className="inline-block bg-ink px-5 pt-3 pb-4 text-[clamp(40px,5vw,68px)] text-on-ink">New escrow</span>
        </h1>
        <p className="m-0 max-w-[24em] font-serif text-[clamp(24px,2.6vw,32px)] leading-[1.2]">
          You&apos;re the payer. Fill it in, read the deal in plain English, then sign.
        </p>
      </div>

      {!address && (
        <div className="slidein flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-menu border-[1.5px] border-ink bg-card px-6 py-5">
          <p className="m-0 max-w-[40em] text-base leading-normal">
            Connect a Stellar wallet to create an escrow. New to Stellar?{" "}
            <Link href="/setup" className="font-bold underline-offset-4">
              Set up in four steps
            </Link>
            .
          </p>
          <button type="button" onClick={openConnect} className="min-h-12 rounded-pill border-0 bg-lime px-[22px] text-[15px] font-bold text-ink">
            Connect wallet
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-start gap-8">
        <fieldset
          disabled={locked}
          className="rise m-0 flex min-w-0 flex-[999_1_520px] flex-col gap-7 rounded-panel border border-line bg-card p-6 min-[720px]:p-8"
          style={{ animationDelay: "120ms" }}
        >
          <legend className="sr-only">Escrow details</legend>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="recipient" className="text-base">
              Who are you paying?
            </Label>
            <Input
              id="recipient"
              placeholder="G…"
              spellCheck={false}
              autoComplete="off"
              invalid={!!errors.recipient}
              aria-describedby={describe("recipient")}
              className="font-mono text-sm"
              {...recipientReg}
              onBlur={(e) => {
                // Keep the secret-key warning: validating the now-empty field would replace it.
                if (errors.recipient?.type === "secret") return;
                void recipientReg.onBlur(e);
              }}
              onChange={(e) => {
                if (guardSecret("recipient", e.target.value)) return;
                if (errors.recipient?.type === "secret") clearErrors("recipient");
                void recipientReg.onChange(e);
              }}
            />
            {errors.recipient ? (
              <FieldError id="recipient-error">{errors.recipient.message}</FieldError>
            ) : (
              <Hint id="recipient-hint" className="text-sm">
                Their Stellar address. Starts with G, 56 characters.
              </Hint>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <Label htmlFor="amount" className="text-base">
              How much?
            </Label>
            <AmountInput
              id="amount"
              placeholder="0.00"
              invalid={!!errors.amount}
              aria-describedby={describe("amount")}
              className="max-w-[360px]"
              {...register("amount")}
            />
            {errors.amount ? (
              <FieldError id="amount-error">{errors.amount.message}</FieldError>
            ) : (
              <Hint id="amount-hint" className="text-sm">
                {!address ? (
                  "Your USDC balance shows once you connect."
                ) : !readiness.data ? (
                  "Checking your balance…"
                ) : usdcLine && balance !== null && balance > 0n ? (
                  <>Balance: {formatUsdc(balance)} test USDC</>
                ) : (
                  <>
                    No USDC yet.{" "}
                    <Link href="/setup" className="font-bold text-violet underline-offset-4">
                      Get test USDC in setup
                    </Link>
                    .
                  </>
                )}
              </Hint>
            )}
          </div>

          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" aria-describedby="deadline-hint">
            <legend className="mb-2.5 p-0 text-base font-bold">Deadline</legend>
            <Segmented<PresetId>
              label="Deadline"
              value={v.preset ?? DEFAULT_PRESET}
              disabled={locked}
              onChange={(p) => {
                setValue("preset", p, { shouldValidate: formState.isSubmitted });
                if (p === "custom" && !v.customDeadline && ledgerNow !== null) {
                  setValue("customDeadline", toLocalInput(Math.floor(ledgerNow) + 3 * 86_400));
                }
              }}
              options={[...PRESETS.map((p) => ({ value: p.id as PresetId, label: p.label })), { value: "custom", label: "Pick a date and time" }]}
            />
            {v.preset === "custom" && (
              <div className="slidein flex flex-col gap-2">
                <Label htmlFor="customDeadline">Date and time (your local time)</Label>
                <Input
                  id="customDeadline"
                  type="datetime-local"
                  invalid={!!errors.customDeadline}
                  aria-describedby={errors.customDeadline ? "customDeadline-error" : undefined}
                  className="max-w-[320px]"
                  {...register("customDeadline")}
                />
                <FieldError id="customDeadline-error">{errors.customDeadline?.message}</FieldError>
              </div>
            )}
            <p id="deadline-hint" className="m-0 text-sm leading-normal text-muted">
              {dl.ok ? (
                <>If the money is still locked after {deadlineText}, you can take it back.</>
              ) : ledgerNow === null ? (
                "Checking Stellar's clock…"
              ) : (
                "Pick a deadline to see when you can take it back."
              )}
            </p>
          </fieldset>

          <div className="flex flex-col gap-2.5">
            <Label htmlFor="title" optional className="text-base">
              What&apos;s it for?
            </Label>
            <Input
              id="title"
              autoComplete="off"
              invalid={!!errors.title}
              aria-describedby={`${errors.title ? "title-error " : ""}title-hint title-count`}
              {...register("title")}
            />
            <FieldError id="title-error">{errors.title?.message}</FieldError>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <Hint id="title-hint" className="text-sm">
                Anyone with the escrow link can read this.
              </Hint>
              <span id="title-count" aria-live="polite" className={cn("tabular text-[13px]", bytes > MAX_TITLE_BYTES ? "font-bold text-error" : "text-muted")}>
                {bytes} / {MAX_TITLE_BYTES} bytes
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-expanded={!!v.arbiterOn}
                aria-controls="arbiter-panel"
                onClick={() => setValue("arbiterOn", !v.arbiterOn, { shouldValidate: formState.isSubmitted })}
                className="inline-flex min-h-11 items-center gap-2 rounded-pill border-[1.5px] border-ink bg-transparent px-[18px] text-[15px] font-bold"
              >
                {v.arbiterOn ? "Remove the arbiter" : "Add an arbiter"}
                <ChevronDown className={cn("transition-transform", v.arbiterOn && "rotate-180")} />
              </button>
              <span className="rounded-pill bg-sand px-2.5 py-0.5 text-xs font-semibold text-muted">Optional</span>
            </div>
            {v.arbiterOn && (
              <div id="arbiter-panel" className="slidein flex flex-col gap-2.5">
                <Label htmlFor="arbiter">Arbiter&apos;s Stellar address</Label>
                <Input
                  id="arbiter"
                  placeholder="G…"
                  spellCheck={false}
                  autoComplete="off"
                  invalid={!!errors.arbiter}
                  aria-describedby={describe("arbiter")}
                  className="font-mono text-sm"
                  {...arbiterReg}
                  onBlur={(e) => {
                    if (errors.arbiter?.type === "secret") return;
                    void arbiterReg.onBlur(e);
                  }}
                  onChange={(e) => {
                    if (guardSecret("arbiter", e.target.value)) return;
                    if (errors.arbiter?.type === "secret") clearErrors("arbiter");
                    void arbiterReg.onChange(e);
                  }}
                />
                <FieldError id="arbiter-error">{errors.arbiter?.message}</FieldError>
                <p id="arbiter-hint" className="m-0 rounded-note bg-sand px-4 py-3 text-sm leading-normal">
                  Someone you both trust to decide if you disagree. They can split the money only after one of you opens a dispute. The recipient
                  should only start work if they trust them too. Without an arbiter there&apos;s no dispute: the money moves only by your release,
                  their refund, or your reclaim after the deadline.
                </p>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-note border-[1.5px] border-line-strong bg-ground px-4 py-3.5 text-[15px] font-semibold">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-ink)]" {...register("lockNow")} />
            <span className="flex flex-col gap-0.5">
              Lock the USDC now, in the same signature
              <span className="text-[13px] font-normal text-muted">Off: you create it now and deposit from the escrow page.</span>
            </span>
          </label>
        </fieldset>

        <aside
          aria-label="Summary"
          className="rise flex min-w-0 flex-[1_1_380px] flex-col gap-6 rounded-panel bg-ink p-6 text-on-ink min-[720px]:p-[30px]"
          style={{ animationDelay: "180ms" }}
        >
          <h2 className="m-0 font-serif text-4xl font-normal leading-none">Here&apos;s the deal</h2>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
            <div className="flex min-w-0 flex-col gap-1 rounded-field border border-ink-line bg-ink-2 px-2.5 py-3 min-[720px]:px-3.5">
              <span className="text-xs text-on-ink-muted">You</span>
              <span className="truncate font-mono text-xs">{address ? shortAddress(address) : "Not connected"}</span>
            </div>
            <div className="glow flex flex-col items-center gap-0.5 rounded-field bg-lime px-2.5 py-2.5 min-[720px]:px-3.5 text-ink">
              <span className="text-[11px] font-bold">Contract holds</span>
              <span className="display tabular whitespace-nowrap text-xl leading-[1.1]">{amtText}</span>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-1 rounded-field border border-ink-line bg-ink-2 px-2.5 py-3 min-[720px]:px-3.5 text-right">
              <span className="text-xs text-on-ink-muted">Recipient</span>
              <span className="truncate font-mono text-xs">{recShort ?? "Not set"}</span>
            </div>
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base leading-normal text-on-ink-soft">
            <Bullet>
              {v.lockNow ? (
                <>
                  You lock <strong className="text-white">{amtText} USDC</strong> in the Sisonke contract.
                </>
              ) : (
                <>
                  After you deposit, <strong className="text-white">{amtText} USDC</strong> is locked in the Sisonke contract.
                </>
              )}
            </Bullet>
            <Bullet>Only you can release it to {recShort ?? "the recipient"}.</Bullet>
            <Bullet>{recShort ?? "The recipient"} can refund it to you at any time.</Bullet>
            <Bullet hollow>If it&apos;s still locked on {deadlineText}, you can take it back.</Bullet>
            {v.arbiterOn && (
              <Bullet>
                If either of you opens a dispute before the deadline, {arbAddr ? shortAddress(arbAddr) : "the arbiter"} decides the split.
              </Bullet>
            )}
            {showUpgradeNote && info && (
              <Bullet hollow>
                This contract&apos;s code can be upgraded after a public {duration(info.upgradeDelay)} notice. If that ever happens before{" "}
                {deadlineText}, you could only get your money back early through {recShort ?? "the recipient"}&apos;s refund
                {v.arbiterOn ? ", or the arbiter" : ""}. Pick a shorter deadline if you want to be able to leave on your own.
              </Bullet>
            )}
          </ul>

          <div className="flex flex-col gap-2.5 border-t border-ink-line pt-5">
            {done && state?.result ? (
              <div className="slidein flex flex-col gap-3.5">
                <span className="display text-[30px]">Escrow {state.escrowId ? padId(state.escrowId) : ""} is live.</span>
                <p className="m-0 text-sm leading-normal text-on-ink-muted">
                  Created in transaction <TxHash hash={state.result.hash} className="!text-lime" />
                  {v.lockNow ? " and the USDC is locked." : ". Deposit next so the recipient can see the money is locked."}
                </p>
                <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5">
                  {state.escrowId && (
                    <Link
                      href={`/escrow/${state.escrowId}`}
                      className="display lift inline-flex min-h-[52px] items-center rounded-pill bg-lime px-6 text-xl text-ink no-underline hover:text-ink"
                    >
                      Go to escrow
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      tx.clear("create");
                      reset(DEFAULTS);
                    }}
                    className="min-h-11 border-0 bg-transparent px-1 text-sm text-on-ink underline underline-offset-[5px]"
                  >
                    Create another
                  </button>
                </div>
              </div>
            ) : state?.phase === "error" && state.error ? (
              <TxError error={state.error} onInk onRetry={() => tx.clear("create")} />
            ) : working && state ? (
              <TxProgress
                tx={state}
                walletName={walletName}
                source={address}
                onInk
                showTitle={false}
                statusNote={v.lockNow ? "Status: Funded." : "Status: Awaiting deposit — not funded."}
              />
            ) : (
              <>
                <button
                  type="submit"
                  aria-disabled={!ready || tx.busy || undefined}
                  onClick={(e) => {
                    if (!ready || tx.busy) {
                      e.preventDefault();
                      if (address) void form.trigger();
                    }
                  }}
                  className={cn(
                    "display min-h-[60px] w-full rounded-pill border-0 text-[22px]",
                    ready ? "lift bg-lime text-ink" : "cursor-not-allowed bg-ink-3 text-faint",
                  )}
                >
                  Create escrow
                </button>
                <p className="m-0 text-center text-[13px] text-on-ink-muted" aria-live="polite">
                  {hint}
                </p>
              </>
            )}
          </div>
        </aside>
      </form>
    </main>
  );
}
