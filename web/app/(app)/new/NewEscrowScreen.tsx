"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import type { ReactNode } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { cn } from "@/lib/cn";
import { MAX_TITLE_BYTES } from "@/lib/config";
import { duration, formatDayName, formatEnds, padId, shortAddress, toLocalInput } from "@/lib/format";
import { useInfo, useReadiness } from "@/lib/hooks/queries";
import { useLedgerClock } from "@/lib/hooks/useLedgerClock";
import { checkArbiter, checkRecipient } from "@/lib/sisonke/address";
import { balanceStroops, formatUsdc, parseAmount } from "@/lib/sisonke/amount";
import { encodeCreate } from "@/lib/sisonke/contract";
import { DEFAULT_PRESET, PRESETS, checkDeadline, customDeadline, presetDeadline, type PresetId } from "@/lib/sisonke/deadline";
import { checkTitle, titleBytes } from "@/lib/sisonke/title";
import { PageHead } from "@/components/app/PageHead";
import { TxError } from "@/components/tx/TxError";
import { TxSteps } from "@/components/tx/TxSteps";
import { useTx } from "@/components/tx/TxProvider";
import { CopyButton } from "@/components/ui/CopyButton";
import { ArrowIcon, CheckIcon, JoinedRings } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
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
  // Presets go through the same bounds as a picked date (min lead, max duration).
  return checkDeadline(presetDeadline(ledgerNow, p.days), ledgerNow);
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

/** A labelled field box: ground fill, ink border once valid, red once wrong. */
function Box({ ok, bad, children, className }: { ok?: boolean; bad?: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[52px] items-center gap-2.5 rounded-note border-[1.5px] px-4 transition-colors focus-within:border-violet",
        bad ? "border-error bg-error-bg" : ok ? "border-ink bg-ground" : "border-line bg-ground",
        className,
      )}
    >
      {children}
    </div>
  );
}

const inputCls = "min-w-0 flex-auto border-0 bg-transparent text-[15px] text-ink outline-none focus-visible:outline-none disabled:cursor-not-allowed";

function Help({ id, bad, children }: { id: string; bad?: boolean; children: ReactNode }) {
  return (
    <span id={id} role={bad ? "alert" : undefined} className={cn("text-[13px] leading-[1.45]", bad ? "font-semibold text-error" : "text-muted")}>
      {children}
    </span>
  );
}

function Rule({ hollow, children }: { hollow?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-[1.45]">
      <span aria-hidden="true" className={cn("mt-px flex size-[22px] shrink-0 items-center justify-center rounded-pill text-lime", hollow ? "border-[1.5px] border-ink-line" : "bg-ink-2")}>
        {!hollow && <CheckIcon size={12} />}
      </span>
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
  const recShort = rec.ok ? shortAddress(rec.address) : "G…";
  const working = !!state && state.phase !== "done" && state.phase !== "error";
  const done = state?.phase === "done" && state.result;
  // An unconfirmed create may still land: never let the form send a second one.
  const unconfirmed = state?.phase === "error" && !!state.error?.pending;
  const locked = working || !!done || unconfirmed;

  const hint = !address
    ? "Connect your wallet to continue."
    : wrongNet
      ? "Switch your wallet to Testnet to sign."
      : paused
        ? "New escrows are paused right now."
        : ledgerNow === null
          ? "Checking Stellar's clock…"
          : !ready
            ? null
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

  const describe = (field: keyof FormValues) => `${field}-help`;

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
  const title = (v.title ?? "").trim();
  const preset = v.preset ?? DEFAULT_PRESET;
  const signLabel = !address ? "Connect wallet" : !rec.ok || !amt.ok ? "Enter recipient and amount" : v.lockNow ? `Fund ${amtText} USDC` : "Create escrow";

  return (
    <main id="main" className="flex flex-col gap-[22px]">
      <PageHead title="New escrow" />
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-start gap-3">
        <fieldset
          disabled={locked}
          className="rise m-0 flex min-w-0 flex-[999_1_420px] flex-col gap-6 rounded-shell border border-line bg-card p-6"
          style={{ animationDelay: "120ms" }}
        >
          <legend className="sr-only">Deal details</legend>

          <div className="flex flex-col gap-2">
            <label htmlFor="recipient" className="text-sm font-bold">
              Recipient
            </label>
            <Box ok={rec.ok} bad={!!errors.recipient}>
              <input
                id="recipient"
                placeholder="G…"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!errors.recipient || undefined}
                aria-describedby={describe("recipient")}
                className={cn(inputCls, "font-mono text-sm")}
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
              {rec.ok && !errors.recipient && <CheckIcon size={18} className="shrink-0 text-ok" />}
            </Box>
            <Help id="recipient-help" bad={!!errors.recipient}>
              {errors.recipient?.message ?? "Stellar address, starts with G"}
            </Help>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="amount" className="text-sm font-bold">
              Amount
            </label>
            <Box ok={amtOk} bad={!!errors.amount}>
              <input
                id="amount"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={!!errors.amount || undefined}
                aria-describedby={describe("amount")}
                className={cn(inputCls, "display tabular text-[21px]")}
                {...register("amount")}
              />
              <span aria-hidden="true" className="text-sm font-extrabold">
                USDC
              </span>
            </Box>
            <Help id="amount-help" bad={!!errors.amount}>
              {errors.amount?.message ??
                (!address ? (
                  "Your balance shows once you connect."
                ) : !readiness.data ? (
                  "Checking your balance…"
                ) : usdcLine && balance !== null && balance > 0n ? (
                  <>Balance {formatUsdc(balance)} USDC</>
                ) : (
                  <>
                    No USDC yet.{" "}
                    <Link href="/setup" className="font-bold text-violet underline-offset-4">
                      Get test USDC
                    </Link>
                  </>
                ))}
            </Help>
          </div>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby="deadline-help">
            <legend className="mb-2 p-0 text-sm font-bold">Deadline</legend>
            <div className="flex flex-wrap gap-2">
              {[...PRESETS.map((p) => ({ value: p.id as PresetId, label: p.label })), { value: "custom" as PresetId, label: "Pick a date" }].map((o) => {
                const on = o.value === preset;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setValue("preset", o.value, { shouldValidate: formState.isSubmitted });
                      if (o.value === "custom" && !v.customDeadline && ledgerNow !== null) {
                        setValue("customDeadline", toLocalInput(Math.floor(ledgerNow) + 3 * 86_400));
                      }
                    }}
                    className={cn("min-h-11 rounded-pill border-[1.5px] px-4 text-sm font-bold", on ? "border-ink bg-ink text-on-ink" : "border-line bg-ground text-ink")}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {preset === "custom" && (
              <div className="slidein flex flex-col gap-2 pt-1">
                <label htmlFor="customDeadline" className="text-[13px] font-semibold">
                  Date and time (your local time)
                </label>
                <Box bad={!!errors.customDeadline} className="max-w-[320px]">
                  <input
                    id="customDeadline"
                    type="datetime-local"
                    aria-invalid={!!errors.customDeadline || undefined}
                    aria-describedby="deadline-help"
                    className={inputCls}
                    {...register("customDeadline")}
                  />
                </Box>
              </div>
            )}
            <Help id="deadline-help" bad={!!errors.customDeadline || !!errors.preset}>
              {errors.customDeadline?.message ?? errors.preset?.message ?? (dl.ok ? <>Ends {formatEnds(dl.deadline)}</> : ledgerNow === null ? "Checking Stellar's clock…" : dl.error)}
            </Help>
          </fieldset>

          <div className="flex flex-col gap-2">
            <label htmlFor="title" className="text-sm font-bold">
              Title <span className="font-medium text-muted">Optional</span>
            </label>
            <Box bad={!!errors.title}>
              <input
                id="title"
                autoComplete="off"
                placeholder="e.g. Café logo, final files"
                aria-invalid={!!errors.title || undefined}
                aria-describedby="title-help title-count"
                className={inputCls}
                {...register("title")}
              />
            </Box>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <Help id="title-help" bad={!!errors.title}>
                {errors.title?.message ?? "Anyone with the link can read it."}
              </Help>
              <span id="title-count" aria-live="polite" className={cn("tabular text-xs", bytes > MAX_TITLE_BYTES ? "font-bold text-error" : "text-muted")}>
                {bytes} / {MAX_TITLE_BYTES} bytes
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-menu bg-ground p-[18px]">
            <div className="flex items-start gap-3.5">
              <div className="flex flex-auto flex-col gap-1">
                <span id="arb-l" className="text-sm font-bold">
                  Add an arbiter
                </span>
                <span id="arb-d" className="text-[13px] leading-[1.45] text-muted">
                  Can split the funds if you disagree.
                </span>
              </div>
              <Switch on={!!v.arbiterOn} labelledBy="arb-l" describedBy="arb-d" disabled={locked} onChange={(on) => setValue("arbiterOn", on, { shouldValidate: formState.isSubmitted })} />
            </div>
            {v.arbiterOn && (
              <div className="popin flex flex-col gap-2">
                <Box bad={!!errors.arbiter} ok={!!arbAddr} className="bg-card">
                  <input
                    id="arbiter"
                    aria-label="Arbiter address"
                    placeholder="Arbiter’s Stellar address"
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!!errors.arbiter || undefined}
                    aria-describedby={describe("arbiter")}
                    className={cn(inputCls, "font-mono text-sm")}
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
                </Box>
                <Help id="arbiter-help" bad={!!errors.arbiter}>
                  {errors.arbiter?.message ?? "Someone you both trust. They act only after one of you opens a dispute."}
                </Help>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3.5 rounded-menu bg-ground p-[18px]">
            <div className="flex flex-auto flex-col gap-1">
              <span id="lock-l" className="text-sm font-bold">
                Fund now
              </span>
              <span id="lock-d" className="text-[13px] leading-[1.45] text-muted">
                {v.lockNow ? "Create and fund in one signature." : "Create now, fund later."}
              </span>
            </div>
            <Switch on={!!v.lockNow} labelledBy="lock-l" describedBy="lock-d" disabled={locked} onChange={(on) => setValue("lockNow", on)} />
          </div>
        </fieldset>

        <section aria-label="Summary" className="rise flex min-w-0 flex-[1_1_340px] flex-col rounded-shell bg-ink p-6 text-on-ink" style={{ animationDelay: "180ms" }}>
          {done && state?.result ? (
            <div className="popin flex flex-col gap-[18px]">
              <JoinedRings width={120} ring="var(--color-on-ink)" lens="var(--color-lime)" stroke={5} />
              <h2 className="display m-0 text-[26px] leading-[0.98]">Escrow {state.escrowId ? padId(state.escrowId) : ""} is live.</h2>
              <p className="m-0 text-[15px] leading-normal text-on-ink-muted">
                {v.lockNow ? `${amtText} USDC locked.` : "Waiting for your deposit."} Transaction <TxHash hash={state.result.hash} className="!text-lime" />
              </p>
              {state.escrowId && (
                <>
                  <CopyButton
                    value={() => `${window.location.origin}/escrow/${state.escrowId}`}
                    label="Copy link"
                    done="Link copied"
                    variant="on-ink-outline"
                    className="!min-h-[52px] !border-on-ink !text-sm"
                  />
                  <Link
                    href={`/escrow/${state.escrowId}`}
                    className="lift-app flex min-h-[52px] items-center justify-center gap-2 rounded-pill bg-lime text-[15px] font-extrabold text-ink no-underline hover:text-ink"
                  >
                    Open the escrow
                    <ArrowIcon size={16} />
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  tx.clear("create");
                  reset(DEFAULTS);
                }}
                className="min-h-11 self-center border-0 bg-transparent px-1 text-sm text-on-ink underline underline-offset-[5px]"
              >
                Create another
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[18px]">
              <span className="font-mono text-xs tracking-[0.08em] text-on-ink-muted uppercase">Summary</span>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-on-ink-muted">{v.lockNow ? "You pay" : "You’ll deposit"}</span>
                <span className="flex items-baseline gap-2">
                  <span className="display tabular text-[35px] leading-[0.95] text-lime">{amtText}</span>
                  <span className="text-sm font-extrabold">USDC</span>
                </span>
                <span className="text-[15px] leading-normal break-words">
                  to <span className="rounded-lg bg-ink-2 px-2 py-0.5 font-mono">{recShort}</span> {title && <>for “{title}”</>}
                </span>
              </div>
              <div aria-hidden="true" className="-mx-6 flex items-center">
                <span className="h-[22px] w-3 shrink-0 rounded-r-pill bg-ground" />
                <span className="mx-2 flex-auto border-t-2 border-dashed border-ink-line" />
                <span className="h-[22px] w-3 shrink-0 rounded-l-pill bg-ground" />
              </div>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                <Rule>Only you can release.</Rule>
                <Rule>Only they can refund.</Rule>
                <Rule>
                  {dl.ok ? <>You can reclaim after {formatDayName(dl.deadline)}</> : "You can reclaim after the deadline"}
                  {v.arbiterOn ? ", unless a dispute is open." : "."}
                </Rule>
                {v.arbiterOn && <Rule>{arbAddr ? shortAddress(arbAddr) : "The arbiter"} can split it in a dispute.</Rule>}
                {showUpgradeNote && info && (
                  <Rule hollow>
                    The code can be upgraded after a public {duration(info.upgradeDelay)} notice. If that happens before the deadline, only {recShort === "G…" ? "the recipient" : recShort}
                    &apos;s refund{v.arbiterOn ? " or the arbiter" : ""} could return your money early. Pick a shorter deadline to keep an exit of your own.
                  </Rule>
                )}
              </ul>
              <span className="text-[13px] text-on-ink-muted">Network fee under 0.25 XLM · No platform fee</span>
              {state?.phase === "error" && state.error ? (
                <TxError error={state.error} onInk onRetry={() => tx.clear("create")} />
              ) : working && state ? (
                <TxSteps tx={state} walletName={walletName} className="bg-ink-2" />
              ) : (
                <div className="flex flex-col gap-2">
                  {!address ? (
                    <button type="button" onClick={() => openConnect("new")} className="display lift-app min-h-[52px] w-full rounded-pill border-0 bg-lime text-lg text-ink">
                      Connect wallet
                    </button>
                  ) : (
                    <button
                      type="submit"
                      aria-disabled={!ready || tx.busy || undefined}
                      onClick={(e) => {
                        if (!ready || tx.busy) {
                          e.preventDefault();
                          void form.trigger();
                        }
                      }}
                      className={cn("display min-h-[52px] w-full rounded-pill border-0 text-lg", ready ? "lift-app bg-lime text-ink" : "cursor-not-allowed bg-ink-line text-faint")}
                    >
                      {signLabel}
                    </button>
                  )}
                  {hint && (
                    <p className="m-0 text-center text-[13px] text-on-ink-muted" aria-live="polite">
                      {hint}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </form>
    </main>
  );
}
