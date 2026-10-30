/**
 * The write pipeline (WEB_PLAN §5.1). Every write runs:
 *   checking (simulate) → signing (wallet) → submitting → confirming.
 * The wallet never opens for a call the contract would refuse, every auth
 * entry must be the source's own, and the signed envelope must be exactly
 * what was prepared, signed by the source for this network.
 */
import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import { config } from "../config";
import type { WriteMethod } from "../sisonke/contract";
import { SisonkeError } from "../sisonke/errors";
import { assertSourceOnlyAuth, sourceAuth } from "./auth";
import { chainError } from "./diagnostics";
import { USDC } from "./horizon";
import { server, sisonke } from "./rpc";

export type TxStage = "checking" | "signing" | "submitting" | "confirming";
export type SignFn = (txXdr: string) => Promise<string>;

export interface TxResult {
  hash: string;
  ledger: number;
  returnValue?: unknown;
  /** Fee charged, in stroops of XLM. */
  feeCharged: bigint | null;
  /** Ledger close time, unix seconds. */
  createdAt: number | null;
}

export interface Run {
  source: string;
  sign: SignFn;
  onStage?: (stage: TxStage) => void;
  /** Fee estimate in stroops of XLM, once simulation knows it. */
  onFee?: (fee: bigint) => void;
}

/** Still not confirmed after polling: keep watching in the background. */
export class PendingError extends SisonkeError {}

async function loadSource(source: string) {
  try {
    return await server.getAccount(source);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === undefined && !/not found/i.test(String((err as Error)?.message))) throw err;
    throw new SisonkeError("No XLM yet", "This wallet has no XLM yet. Get test XLM in Test funds.", { label: "Get test XLM", href: "/setup" });
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const isFeeBump = (t: Transaction | FeeBumpTransaction): t is FeeBumpTransaction => "innerTransaction" in t;

/**
 * Checks the wallet's envelope: same transaction (hash), and a valid
 * signature by `source` over that hash, which also proves it was signed for
 * this network's passphrase.
 */
export function verifySigned(prepared: Transaction, signedXdr: string, source: string): Transaction {
  let signed: Transaction | FeeBumpTransaction;
  try {
    signed = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  } catch {
    throw new SisonkeError("Wallet sent something else", "The wallet returned a transaction Sisonke couldn't read. Nothing was sent.");
  }
  if (isFeeBump(signed) || !sameBytes(signed.hash(), prepared.hash())) {
    throw new SisonkeError("Wallet changed the transaction", "The wallet returned a different transaction than the one checked. Nothing was sent.");
  }
  const key = Keypair.fromPublicKey(source);
  const ok = signed.signatures.some((sig) => {
    try {
      return key.verify(prepared.hash(), sig.signature);
    } catch {
      return false;
    }
  });
  if (!ok) {
    throw new SisonkeError(
      "Wrong network",
      "Your wallet signed for a different network. Switch it to Testnet and try again. Nothing was sent.",
    );
  }
  return signed;
}

function feeFrom(resultXdr: xdr.TransactionResult | undefined): bigint | null {
  try {
    return resultXdr ? BigInt(resultXdr.feeCharged) : null;
  } catch {
    return null;
  }
}

function sendCode(result: xdr.TransactionResult | undefined): string {
  try {
    return result?.result.type ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function submit(prepared: Transaction, run: Run): Promise<TxResult> {
  run.onStage?.("signing");
  let signedXdr: string;
  try {
    signedXdr = await run.sign(prepared.toXDR());
  } catch (err) {
    throw err instanceof Error ? err : Object.assign(new Error(`rejected: ${String((err as { message?: string })?.message ?? err)}`), err as object);
  }
  const signed = verifySigned(prepared, signedXdr, run.source);
  // Known before sending, so a lost response can't hide a transaction that landed.
  const hash = Array.from(signed.hash(), (b) => b.toString(16).padStart(2, "0")).join("");

  run.onStage?.("submitting");
  let sent: rpc.Api.SendTransactionResponse | null = null;
  try {
    sent = await server.sendTransaction(signed);
  } catch {
    // The RPC may have accepted it before the connection dropped: watch for it below.
  }
  if (sent?.status === "TRY_AGAIN_LATER") throw new Error("TRY_AGAIN_LATER");
  if (sent?.status === "ERROR") {
    const detail = chainError(sent.diagnosticEvents) ?? sendCode(sent.errorResult);
    throw new Error(detail);
  }

  run.onStage?.("confirming");
  const res = await waitForResult(hash, Number(signed.timeBounds?.maxTime ?? 0));
  if (res?.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      hash,
      ledger: res.ledger,
      returnValue: res.returnValue ? scValToNative(res.returnValue) : undefined,
      feeCharged: feeFrom(res.resultXdr),
      createdAt: res.createdAt ? Number(res.createdAt) : null,
    };
  }
  if (res?.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw Object.assign(new Error(chainError(res.diagnosticEventsXdr) ?? sendCode(res.resultXdr)), { hash });
  }
  if (res?.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    // Its time bound has passed and Stellar never included it, so it can never land.
    throw new SisonkeError("It didn't go through", "Stellar never included this transaction and it has now expired. Nothing was sent, so it's safe to try again.");
  }
  throw new PendingError(
    "Couldn't confirm",
    `Sisonke lost contact with Stellar before it could confirm ${hash.slice(0, 8)}…. It may still have gone through: check the transaction on Stellar Expert before trying again.`,
    undefined,
    hash,
  );
}

/** Seconds after the time bound before a missing transaction counts as never landing. */
const EXPIRY_GRACE = 30;
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until the transaction succeeds or fails, or until its time bound has
 * passed and Stellar still reports it missing. Transport errors are retried.
 * Returns null if Stellar couldn't be reached at the end, so the outcome is unknown.
 */
async function waitForResult(hash: string, maxTime: number): Promise<rpc.Api.GetTransactionResponse | null> {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const until = (maxTime > 0 ? maxTime : nowSec() + 180) + EXPIRY_GRACE;
  let last: rpc.Api.GetTransactionResponse | null = null;
  for (;;) {
    try {
      last = await server.getTransaction(hash);
      if (last.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return last;
    } catch {
      last = null;
    }
    if (nowSec() > until) return last;
    await sleepMs(1000);
  }
}

/** Calls a sisonke-escrow function, signed by `source`, its only signer. */
export async function invoke(method: WriteMethod, args: xdr.ScVal[], run: Run): Promise<TxResult> {
  run.onStage?.("checking");
  const account = await loadSource(run.source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })
    .addOperation(sisonke.call(method, ...args))
    .setTimeout(180)
    .build();
  const sim = await server.simulateTransaction(tx);
  // A contract error (InvalidStatus, a missing trustline…) shows here, before the wallet opens.
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  assertSourceOnlyAuth(sim.result?.auth);
  run.onFee?.(BigInt(BASE_FEE) + BigInt(sim.minResourceFee));
  return submit(rpc.assembleTransaction(tx, sim).build(), run);
}

export type ProbeResult = { ok: true } | { ok: false; error: string; enforced: boolean };

/**
 * "Try anyway": simulates the call in enforcing-auth mode with the source's
 * own auth entry, so a wrong signer is refused like on-chain. Nothing is
 * signed or sent. Falls back to record mode if the RPC rejects authMode.
 */
export async function probe(method: WriteMethod, args: xdr.ScVal[], source: string): Promise<ProbeResult> {
  const account = await loadSource(source);
  const op = Operation.invokeContractFunction({
    contract: config.contractId,
    function: method,
    args,
    auth: [sourceAuth(method, args)],
  });
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })
    .addOperation(op)
    .setTimeout(60)
    .build();
  let sim: rpc.Api.SimulateTransactionResponse;
  let enforced = true;
  try {
    sim = await server.simulateTransaction(tx, undefined, "enforce");
  } catch {
    enforced = false;
    const plain = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })
      .addOperation(sisonke.call(method, ...args))
      .setTimeout(60)
      .build();
    sim = await server.simulateTransaction(plain);
  }
  if (rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error, enforced };
  return { ok: true };
}

/** Classic operations (trustline, DEX swap): no simulation; "checking" loads the account. */
async function classic(op: xdr.Operation, run: Run): Promise<TxResult> {
  run.onStage?.("checking");
  const account = await loadSource(run.source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })
    .addOperation(op)
    .setTimeout(180)
    .build();
  run.onFee?.(BigInt(BASE_FEE));
  return submit(tx, run);
}

export function addUsdcTrustline(run: Run): Promise<TxResult> {
  return classic(Operation.changeTrust({ asset: USDC }), run);
}

/** XLM → USDC to self on the Testnet DEX, spending at most `sendMax` XLM. */
export function swapXlmForUsdc(
  { destAmount, sendMax, path }: { destAmount: string; sendMax: string; path: Asset[] },
  run: Run,
): Promise<TxResult> {
  return classic(
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax,
      destination: run.source,
      destAsset: USDC,
      destAmount,
      path,
    }),
    run,
  );
}

export interface PrecheckCtx {
  method: WriteMethod;
  connected: boolean;
  onTestnet: boolean | null;
  /** From the readiness read; undefined while it hasn't loaded. */
  readiness?: { exists: boolean; usdc: { balance: string; authorized: boolean } | null };
  /** Stroops the call moves out of the wallet (fund, create_and_fund). */
  amount?: bigint;
  /** Wallet USDC balance in stroops. */
  usdcBalance?: bigint;
  formatAmount: (stroops: bigint) => string;
}

/** Local checks before stage 1 (WEB_PLAN §5.1 step 1). Null when it may proceed. */
export function precheck(c: PrecheckCtx): SisonkeError | null {
  if (!c.connected) return new SisonkeError("Connect a wallet", "Connect a wallet to sign this. Nothing was sent.");
  if (c.onTestnet === false) {
    return new SisonkeError("Wrong network", "Switch your wallet to Testnet to sign. Nothing was sent.");
  }
  if (c.readiness && !c.readiness.exists && c.method !== "migrate") {
    return new SisonkeError("No XLM yet", "This wallet has no XLM yet. Get test XLM in Test funds.", { label: "Get test XLM", href: "/setup" });
  }
  if ((c.method === "fund" || c.method === "create_and_fund") && c.readiness && c.amount !== undefined) {
    const line = c.readiness.usdc;
    if (!line) {
      return new SisonkeError(
        "Your wallet can't hold USDC yet",
        "Add the USDC trustline first. It takes one signature. Nothing was sent.",
        { label: "Add the trustline", href: "/setup" },
      );
    }
    if (!line.authorized) {
      return new SisonkeError("USDC is frozen on your wallet", "Circle has frozen USDC for your wallet, so it can't send it. Nothing was sent.");
    }
    const have = c.usdcBalance ?? 0n;
    if (have < c.amount) {
      return new SisonkeError(
        "Not enough USDC",
        `This deposit needs ${c.formatAmount(c.amount)} USDC and your wallet has ${c.formatAmount(have)}. Top up, then try again. Nothing was sent.`,
        { label: "Get test USDC", href: "/setup" },
      );
    }
  }
  return null;
}
