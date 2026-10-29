/**
 * Sisonke Testnet end-to-end proof. Runs scenarios A–G against the deployed
 * contract and writes docs/TRANSACTIONS.md (a Stellar Expert link per step)
 * plus deployments/testnet-e2e.json (the same rows, machine-readable).
 *
 *   cd scripts && npm install
 *   node e2e.ts setup   # once: 4 keypairs in scripts/.env, Friendbot XLM, USDC
 *                       # trustlines, and USDC for the payer bought on the DEX
 *   node e2e.ts         # scenarios A–G
 *
 * Reads the contract id from deployments/testnet.env (written by deploy.sh).
 * scripts/.env holds Testnet secret keys and is never committed.
 * Environment variables override both files; E2E_KEYS_FILE, E2E_OUT and
 * E2E_JSON change where keys are kept and where the reports are written.
 *
 * Every rejection is first shown by simulation, then submitted on-chain
 * anyway so the failed transaction is verifiable. A row passes only if the
 * simulated error is the expected one and the network recorded the same.
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";

// ------------------------------------------------------------------ config

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYS_FILE = path.resolve(process.env.E2E_KEYS_FILE ?? path.join(ROOT, "scripts/.env"));
const DEPLOY_FILE = path.join(ROOT, "deployments/testnet.env");
const OUT_FILE = path.resolve(process.env.E2E_OUT ?? path.join(ROOT, "docs/TRANSACTIONS.md"));
const JSON_FILE = path.resolve(process.env.E2E_JSON ?? path.join(ROOT, "deployments/testnet-e2e.json"));

if (existsSync(DEPLOY_FILE)) process.loadEnvFile(DEPLOY_FILE);
if (existsSync(KEYS_FILE)) process.loadEnvFile(KEYS_FILE);

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) fail(`Missing ${name}. Run scripts/deploy.sh first.`);
  return value;
};

const PASSPHRASE = env("NEXT_PUBLIC_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
const RPC_URL = env("NEXT_PUBLIC_RPC_URL", "https://soroban-testnet.stellar.org");
const HORIZON_URL = env("NEXT_PUBLIC_HORIZON_URL", "https://horizon-testnet.stellar.org");
const EXPLORER = env("NEXT_PUBLIC_EXPLORER_URL", "https://stellar.expert/explorer/testnet");
const USDC_ISSUER = env("NEXT_PUBLIC_USDC_ISSUER", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const FRIENDBOT = "https://friendbot.stellar.org";

const USDC = new Asset("USDC", USDC_ISSUER);
/** 1 USDC per escrow (7 decimals). */
const AMOUNT = 10_000_000n;
/** E's arbiter split: 0.6 USDC to the recipient, 0.4 back to the payer. */
const SPLIT = 6_000_000n;
/** A, C and part of E end up with the recipient; B, F and the rest come back. */
const USDC_NEEDED = 5;
/** What setup tops the payer up to when it is below USDC_NEEDED. */
const USDC_TARGET = 10;
/** Most XLM setup will spend buying USDC on the DEX. */
const MAX_XLM_FOR_USDC = 100;
const DISPUTE_SECONDS = 90;
const RECLAIM_SECONDS = 60;

/** Contract error names, keyed by code (contracts/sisonke-escrow/src/errors.rs). */
const ERROR_NAMES: Record<number, string> = {
  100: "NotFound",
  101: "InvalidStatus",
  102: "DeadlinePassed",
  103: "DeadlineNotReached",
  104: "NoArbiter",
  105: "NotParty",
  106: "InvalidSplit",
  107: "TransferMismatch",
  120: "InvalidAmount",
  121: "SameParty",
  122: "InvalidArbiter",
  123: "InvalidParty",
  124: "DeadlineInPast",
  125: "DeadlineTooFar",
  126: "TitleTooLong",
  127: "BatchTooLarge",
  128: "InvalidTitle",
  140: "Paused",
  141: "MigrationRequired",
  142: "NothingToMigrate",
  143: "Overflow",
  200: "UpgradesLocked",
  201: "NoPendingAdmin",
  202: "InvalidUpgradeDelay",
  203: "NoPendingUpgrade",
  204: "UpgradeTooEarly",
  205: "UpgradeDelayDecrease",
  206: "UpgradeHashMismatch",
  207: "UpgradeExpired",
};
/** One line per code for the TRANSACTIONS.md legend (docs/CONTRACT.md, Errors). */
const ERROR_MEANINGS: Record<number, string> = {
  100: "no escrow with this id.",
  101: "the escrow's status doesn't allow this action (every duplicate lands here); nothing moved.",
  102: "fund or dispute at or after the deadline.",
  103: "the payer tried to reclaim before the deadline.",
  104: "the escrow has no arbiter.",
  105: "dispute by an address that is neither payer nor recipient.",
  106: "split amount out of range.",
  107: "the contract did not receive exactly the escrow amount.",
};
const AUTH_ERROR = "Auth error (InvalidAction)";
const contractError = (code: number) => `Error #${code} ${ERROR_NAMES[code] ?? ""}`.trim();

const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

type Role = "payer" | "recipient" | "arbiter" | "stranger";
const ROLES: Role[] = ["payer", "recipient", "arbiter", "stranger"];
/** Only these receive USDC; the arbiter never does. */
const USDC_ROLES: Role[] = ["payer", "recipient"];
const keyVar = (role: Role) => `E2E_${role.toUpperCase()}_SECRET`;

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------- setup

async function setup() {
  const lines: string[] = [];
  const keys = {} as Record<Role, Keypair>;
  for (const role of ROLES) {
    const secret = process.env[keyVar(role)];
    keys[role] = secret ? Keypair.fromSecret(secret) : Keypair.random();
    lines.push(`${keyVar(role)}=${keys[role].secret()}`);
  }
  writeFileSync(
    KEYS_FILE,
    `# Testnet-only keys for scripts/e2e.ts. Never commit this file.\n${lines.join("\n")}\n`,
  );

  for (const role of ROLES) {
    const kp = keys[role];
    if (!(await accountExists(kp.publicKey()))) {
      const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
      if (!res.ok) fail(`Friendbot failed for ${role}: ${res.status}`);
      console.log(`✓ ${role} funded with Friendbot XLM`);
    }
    if (USDC_ROLES.includes(role) && (await usdcBalance(kp.publicKey())) === null) {
      await submitClassic(kp, Operation.changeTrust({ asset: USDC }));
      console.log(`✓ ${role} USDC trustline added`);
    }
    console.log(`  ${role.padEnd(9)} ${kp.publicKey()}`);
  }

  const ready = await topUpUsdc(keys.payer);
  const balance = (await usdcBalance(keys.payer.publicKey())) ?? 0;
  console.log(`\nPayer USDC balance: ${balance}`);
  console.log(ready ? "\nReady. Run: node e2e.ts" : "");
}

/**
 * Buys USDC for `kp` with its own XLM on the Testnet DEX
 * (pathPaymentStrictReceive to itself) when it holds less than
 * USDC_NEEDED. Falls back to pointing at Circle's faucet when Horizon finds
 * no path. Returns whether the account now has enough.
 */
async function topUpUsdc(kp: Keypair): Promise<boolean> {
  const have = (await usdcBalance(kp.publicKey())) ?? 0;
  if (have >= USDC_NEEDED) return true;
  const want = (USDC_TARGET - have).toFixed(7);
  const faucet = () => {
    console.log(
      `\nNext: send ≥ ${USDC_NEEDED} Testnet USDC to the payer at https://faucet.circle.com\n` +
        `  (network: Stellar Testnet, address: ${kp.publicKey()})\n` +
        `Then run: node e2e.ts`,
    );
    return false;
  };

  const paths = await horizon.strictReceivePaths([Asset.native()], USDC, want).call();
  const native = paths.records.filter((r: any) => r.source_asset_type === "native");
  if (!native.length) {
    console.log(`No XLM → USDC path on the DEX for ${want} USDC.`);
    return faucet();
  }
  const best = native.reduce((a: any, b: any) => (Number(b.source_amount) < Number(a.source_amount) ? b : a));
  const quote = Number(best.source_amount);
  if (quote > MAX_XLM_FOR_USDC) {
    console.log(`The DEX wants ${quote} XLM for ${want} USDC, over the ${MAX_XLM_FOR_USDC} XLM cap.`);
    return faucet();
  }
  // Generous slippage: 3× the quote, but never more than the cap.
  const sendMax = Math.min(quote * 3, MAX_XLM_FOR_USDC).toFixed(7);
  const via = (best.path as any[]).map((p) =>
    p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
  );
  try {
    await submitClassic(
      kp,
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax,
        destination: kp.publicKey(),
        destAsset: USDC,
        destAmount: want,
        path: via,
      }),
    );
  } catch (e: any) {
    const codes = e?.response?.data?.extras?.result_codes;
    console.log(`DEX purchase failed: ${codes ? JSON.stringify(codes) : e?.message ?? e}`);
    return faucet();
  }
  console.log(`✓ bought ${want} USDC for ≤ ${sendMax} XLM (quoted ${quote} XLM)`);
  return true;
}

async function submitClassic(kp: Keypair, op: xdr.Operation) {
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
}

async function accountExists(address: string): Promise<boolean> {
  try {
    await horizon.loadAccount(address);
    return true;
  } catch (e: any) {
    if (e?.response?.status === 404) return false;
    throw e;
  }
}

/** USDC balance as a number, or null if the account has no trustline. */
async function usdcBalance(address: string): Promise<number | null> {
  const account = await horizon.loadAccount(address);
  const line = account.balances.find(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER,
  );
  return line ? Number(line.balance) : null;
}

// ------------------------------------------------------------ chain helpers

const u64 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const addr = (kp: Keypair) => nativeToScVal(kp.publicKey(), { type: "address" });
const str = (s: string) => nativeToScVal(s, { type: "string" });
const none = () => xdr.ScVal.scvVoid();
const sha256 = (s: string) => nativeToScVal(createHash("sha256").update(s).digest(), { type: "bytes" });

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const txLink = (hash: string) => `[\`${short(hash)}\`](${EXPLORER}/tx/${hash})`;

function describeError(raw: string): string {
  const contract = raw.match(/Error\(Contract, #(\d+)\)/);
  if (contract) return contractError(Number(contract[1]));
  const auth = raw.match(/Error\(Auth, (\w+)\)/);
  if (auth) return `Auth error (${auth[1]})`;
  return raw.split("\n")[0].slice(0, 120);
}

/** SCError type / code numbers that matter here (stellar-xdr Stellar-contract.x). */
const SC_ERROR_TYPES: Record<number, string> = { 9: "Auth" };
const SC_ERROR_CODES: Record<number, string> = { 6: "InvalidAction" };

/**
 * The error the network recorded for a failed invocation, read from the
 * `host_fn_failed` diagnostic event. Same wording as `describeError`.
 */
function chainError(events: xdr.DiagnosticEvent[] | undefined): string | undefined {
  for (const event of events ?? []) {
    const body = (event as any).event?.body;
    const topics: xdr.ScVal[] = (body?.value ?? body)?.topics ?? [];
    if (topics.length < 2) continue;
    try {
      if (scValToNative(topics[0]) !== "host_fn_failed") continue;
    } catch {
      continue;
    }
    const err = ((topics[1] as any).value ?? topics[1])?.toXdrObject?.() ?? {};
    if (err.contractCode !== undefined) return contractError(err.contractCode);
    const type = SC_ERROR_TYPES[err.type] ?? `type ${err.type}`;
    return type === "Auth"
      ? `Auth error (${SC_ERROR_CODES[err.code] ?? err.code})`
      : `Host error (${type}, code ${err.code})`;
  }
  return undefined;
}

async function baseTx(source: Keypair, op: xdr.Operation, fee = BASE_FEE): Promise<Transaction> {
  const account = await server.getAccount(source.publicKey());
  return new TransactionBuilder(account, { fee, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(120)
    .build();
}

/** What a successful call needed, so a duplicate can be replayed on-chain. */
type Replay = { data: xdr.SorobanTransactionData; auth: xdr.SorobanAuthorizationEntry[] };

type Sent = {
  status: "SUCCESS" | "FAILED";
  hash: string;
  ledger?: number;
  value?: unknown;
  detail: string;
  error?: string;
};

async function send(tx: Transaction, signer: Keypair): Promise<Sent> {
  tx.sign(signer);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    const code = sent.errorResult ? failureCode(sent.errorResult) : sent.status;
    return { status: "FAILED", hash: sent.hash, detail: `not accepted: ${code}` };
  }
  const res = await server.pollTransaction(sent.hash, { attempts: 60 });
  if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    const value = res.returnValue ? scValToNative(res.returnValue) : undefined;
    return { status: "SUCCESS", hash: sent.hash, ledger: res.ledger, value, detail: "SUCCESS" };
  }
  if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
    return {
      status: "FAILED",
      hash: sent.hash,
      ledger: res.ledger,
      detail: failureCode(res.resultXdr),
      error: chainError(res.diagnosticEventsXdr),
    };
  }
  return { status: "FAILED", hash: sent.hash, detail: `not confirmed: ${res.status}` };
}

/** Most specific result code: the invoke result (e.g. invokeHostFunctionTrapped) or the tx code. */
function failureCode(result: xdr.TransactionResult): string {
  const tx = result.result as { type: string; results?: Array<{ type: string; tr?: { value?: { type?: string } } }> };
  const op = tx.results?.[0];
  return op?.type === "opInner" ? (op.tr?.value?.type ?? tx.type) : tx.type;
}

/** Created on first use, so `node e2e.ts setup` works before anything is deployed. */
let contract: Contract | undefined;
const sisonke = (): Contract => (contract ??= new Contract(env("NEXT_PUBLIC_SISONKE_CONTRACT_ID")));

type Invoked =
  | { ok: false; error: string; sent?: undefined; replay?: undefined }
  | { ok: boolean; sent: Sent; replay: Replay; error?: undefined };

/** Simulate, assemble, sign as `signer` (the source and only required auth), send. */
async function invoke(signer: Keypair, method: string, args: xdr.ScVal[]): Promise<Invoked> {
  const tx = await baseTx(signer, sisonke().call(method, ...args));
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    return { ok: false, error: describeError(sim.error) };
  }
  const replay: Replay = { data: sim.transactionData.build(), auth: sim.result?.auth ?? [] };
  const sent = await send(rpc.assembleTransaction(tx, sim).build(), signer);
  return { ok: sent.status === "SUCCESS", sent, replay };
}

/** Read-only call through simulation: no signature, no fee. */
async function read(method: string, args: xdr.ScVal[], source: Keypair): Promise<any> {
  const tx = await baseTx(source, sisonke().call(method, ...args));
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(describeError(sim.error));
  return scValToNative(sim.result!.retval);
}

/**
 * Footprint and resources for a call that will be refused by contract logic or
 * auth, so it can't be simulated successfully itself: borrowed from a read that
 * touches the same entries (`get_escrow(id)`: instance, code and `Escrow(id)`;
 * `is_paused()` for admin calls), with generous limits on top.
 */
async function probeData(signer: Keypair, id: bigint | null): Promise<xdr.SorobanTransactionData> {
  const call = id === null ? sisonke().call("is_paused") : sisonke().call("get_escrow", u64(id));
  const probe = await server.simulateTransaction(await baseTx(signer, call));
  if (rpc.Api.isSimulationError(probe)) fail(`probe for ${id ?? "admin call"} failed: ${probe.error}`);
  const probed = probe.transactionData.build();
  const res = probed.resources;
  return new SorobanDataBuilder(probed)
    .setResources(res.instructions * 4 + 2_000_000, res.diskReadBytes + 10_000, res.writeBytes + 10_000)
    .setResourceFee(BigInt(probed.resourceFee) * 4n + 200_000n)
    .build();
}

/** The source-account authorization entry a call by the tx source needs. */
function sourceAuth(method: string, args: xdr.ScVal[]): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(sisonke().contractId()).toScAddress(),
          functionName: method,
          args,
        }),
      ),
      subInvocations: [],
    }),
  });
}

const statusName = (s: unknown) => (Array.isArray(s) ? String(s[0]) : String(s));

async function ledgerTime(): Promise<number> {
  return Number((await server.getLatestLedger()).closeTime);
}

async function waitUntil(deadline: number, label: string) {
  process.stdout.write(`… waiting for ${label}`);
  while ((await ledgerTime()) < deadline) {
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 5_000));
  }
  console.log();
}

// ----------------------------------------------------------------- report

type Row = {
  scenario: string;
  step: string;
  signer: string;
  method: string;
  escrow_id: string | null;
  expected: string;
  result: string;
  hash: string | null;
  ledger: number | null;
  pass: boolean;
};
const rows: Row[] = [];
const SCENARIOS: Record<string, string> = {
  A: "A. Two-step happy path",
  B: "B. Recipient refund",
  C: "C. Unauthorized",
  D: "D. Duplicates",
  E: "E. Dispute and split",
  F: "F. Deadline reclaim",
  G: "G. Cancel",
};

function record(row: Row) {
  rows.push(row);
  const mark = row.pass ? "✓" : "✖";
  console.log(
    `${mark} ${row.scenario}  ${row.step.padEnd(34)} ${row.signer.padEnd(9)} ${row.result}${row.hash ? `  ${row.hash}` : ""}`,
  );
}

function writeReports(keys: Record<Role, Keypair>, startedAt: Date) {
  const contractId = sisonke().contractId();
  const legend = [...new Set(rows.map((r) => r.expected.replace(/^⛔ /, "")))]
    .filter((e) => e.startsWith("Error #"))
    .sort();
  const out: string[] = [
    "# Sisonke: Testnet transactions",
    "",
    `Generated by \`scripts/e2e.ts\` on ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC against`,
    `[\`${contractId}\`](${EXPLORER}/contract/${contractId}) on Stellar Testnet.`,
    "",
    `- Deploy transaction: ${process.env.SISONKE_DEPLOY_TX && process.env.SISONKE_DEPLOY_TX !== "unknown" ? txLink(process.env.SISONKE_DEPLOY_TX) : "not recorded (see deployments/testnet.env)"}`,
    `- Wasm hash: \`${process.env.SISONKE_WASM_HASH ?? "not recorded"}\` (\`stellar contract fetch --id ${contractId} --network testnet | shasum -a 256\`)`,
    `- Source revision: \`${process.env.SISONKE_SOURCE_REV ?? "not recorded"}\``,
    "",
    "Scenarios A, B, C, E, F and G end with a successful transaction (C after six refused attacks).",
    "The ⛔ rows are calls the contract must refuse.",
    "Each refusal is first shown by simulation, then submitted on-chain anyway so the failed",
    "transaction is verifiable too; a row passes only if the network recorded the expected error.",
    "Every hash opens on Stellar Expert.",
    "",
    `- **${AUTH_ERROR}**: the call lacked the signature of the party the contract requires`,
    "  (`require_auth`), so it stopped before any contract logic ran.",
    ...legend.map((e) => `- **${e}**: ${ERROR_MEANINGS[Number(e.match(/#(\d+)/)![1])] ?? "see docs/CONTRACT.md, Errors."}`),
    "",
    "| Account | Address |",
    "|---|---|",
    ...ROLES.map((r) => `| ${r} | [\`${keys[r].publicKey()}\`](${EXPLORER}/account/${keys[r].publicKey()}) |`),
    "",
    `Each escrow locks ${Number(AMOUNT) / 1e7} USDC.`,
  ];
  for (const [key, title] of Object.entries(SCENARIOS)) {
    const list = rows.filter((r) => r.scenario === key);
    if (!list.length) continue;
    out.push("", `## ${title}`, "", "| Step | Signer | Expected | Result | Transaction |", "|---|---|---|---|---|");
    for (const r of list) {
      out.push(
        `| ${r.step} | ${r.signer} | ${r.expected} | ${r.pass ? "" : "❌ "}${r.result} | ${r.hash ? txLink(r.hash) : "n/a"} |`,
      );
    }
  }
  const failed = rows.filter((r) => !r.pass).length;
  out.push(
    "",
    "## Summary",
    "",
    failed
      ? `**${failed} step(s) did not behave as expected.** See the ❌ rows above.`
      : `All ${rows.length} steps behaved as expected.`,
    "",
  );
  writeFileSync(OUT_FILE, out.join("\n"));
  writeFileSync(JSON_FILE, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\nWrote ${OUT_FILE}\nWrote ${JSON_FILE}`);
}

// -------------------------------------------------------------- scenarios

async function run() {
  const keys = {} as Record<Role, Keypair>;
  for (const role of ROLES) {
    const secret = process.env[keyVar(role)];
    if (!secret) fail(`Missing ${keyVar(role)}. Run: node e2e.ts setup`);
    keys[role] = Keypair.fromSecret(secret);
  }
  const { payer, recipient, arbiter, stranger } = keys;
  const who = (kp: Keypair) => ROLES.find((r) => keys[r].publicKey() === kp.publicKey())!;

  const balance = await usdcBalance(payer.publicKey());
  if (balance === null || balance < USDC_NEEDED) {
    fail(`Payer needs ≥ ${USDC_NEEDED} Testnet USDC (has ${balance ?? "no trustline"}). Run: node e2e.ts setup`);
  }
  if ((await usdcBalance(recipient.publicKey())) === null) fail("Recipient has no USDC trustline. Run: node e2e.ts setup");

  const startedAt = new Date();
  const replays = new Map<string, Replay>();

  /** A step that must succeed. Returns the escrow id. */
  async function expectSuccess(
    scenario: string,
    step: string,
    signer: Keypair,
    method: string,
    args: xdr.ScVal[],
    expectedStatus: string,
    id?: bigint,
  ): Promise<bigint> {
    const res = await invoke(signer, method, args);
    const base = { scenario, step, signer: who(signer), method, expected: `✅ ${expectedStatus}` };
    if (!res.ok || !res.sent) {
      const result = res.error ?? res.sent?.detail ?? "unknown error";
      record({ ...base, escrow_id: id?.toString() ?? null, result, hash: res.sent?.hash ?? null, ledger: res.sent?.ledger ?? null, pass: false });
      writeReports(keys, startedAt);
      fail(`${scenario} ${step} failed: ${result}`);
    }
    const escrowId = id ?? (res.sent.value as bigint);
    replays.set(`${escrowId}:${method}`, res.replay!);
    const status = statusName((await read("get_escrow", [u64(escrowId)], payer)).escrow.status);
    record({
      ...base,
      escrow_id: escrowId.toString(),
      result: `✅ ${status}`,
      hash: res.sent.hash,
      ledger: res.sent.ledger ?? null,
      pass: status === expectedStatus,
    });
    return escrowId;
  }

  /**
   * A call the contract must refuse with `expected`. Shows the reason by
   * simulation, then submits it on-chain for a verifiable failed hash:
   * - "unauthorized": the attacker submits the call with the auth entries it
   *   cannot sign stripped out. The footprint comes from the recording
   *   simulation, or, when that fails on a later check (the contract runs
   *   past `require_auth` in recording mode), from `probeData`.
   * - "duplicate": replays the original successful call's footprint and auth.
   * - "contract": a refusal by contract logic with nothing to replay; the
   *   footprint comes from `probeData`, plus the signer's own source-account auth.
   */
  async function expectRejection(
    scenario: string,
    step: string,
    signer: Keypair,
    method: string,
    args: xdr.ScVal[],
    id: bigint | null,
    kind: "unauthorized" | "duplicate" | "contract",
    expected: string,
  ) {
    const base = { scenario, step, signer: who(signer), method, escrow_id: id?.toString() ?? null, expected: `⛔ ${expected}` };
    const tx = await baseTx(signer, sisonke().call(method, ...args));
    // Enforce mode checks signatures like the network does; record mode would
    // happily list the missing signature as "required" instead of failing.
    const sim = await server.simulateTransaction(tx, undefined, kind === "unauthorized" ? "enforce" : undefined);
    if (!rpc.Api.isSimulationError(sim)) {
      record({ ...base, result: "Simulation succeeded; expected a rejection", hash: null, ledger: null, pass: false });
      return;
    }
    const reason = describeError(sim.error);

    let data: xdr.SorobanTransactionData;
    let auth: xdr.SorobanAuthorizationEntry[];
    if (kind === "unauthorized") {
      // The signature the attacker cannot produce is simply left out.
      auth = [];
      const recording = await server.simulateTransaction(tx);
      data = rpc.Api.isSimulationError(recording) ? await probeData(signer, id) : recording.transactionData.build();
    } else if (kind === "duplicate") {
      const replay = replays.get(`${id}:${method}`);
      if (!replay) fail(`No successful ${method}(${id}) to replay`);
      ({ data, auth } = replay);
    } else {
      data = await probeData(signer, id);
      auth = [sourceAuth(method, args)];
    }
    const op = Operation.invokeContractFunction({ contract: sisonke().contractId(), function: method, args, auth });
    const account = await server.getAccount(signer.publicKey());
    // The builder adds the Soroban resource fee to this inclusion fee itself.
    const proof = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(op)
      .setSorobanData(data)
      .setTimeout(120)
      .build();
    const sent = await send(proof, signer);
    const onChain = sent.error ? `FAILED on-chain with ${sent.error}` : `FAILED on-chain (${sent.detail})`;
    // Pass only if simulation gave the expected reason and the network
    // rejected the transaction for that same reason.
    const pass = reason === expected && sent.status === "FAILED" && sent.error === expected;
    record({
      ...base,
      result: sent.status === "SUCCESS" ? "Accepted on-chain; expected a rejection" : `⛔ ${reason} · ${onChain}`,
      hash: sent.hash,
      ledger: sent.ledger ?? null,
      pass,
    });
  }

  /** `total_locked` and the contract's USDC balance, for "funds untouched" checks. */
  async function funds(): Promise<{ locked: bigint; balance: bigint }> {
    const usdc = new Contract(env("NEXT_PUBLIC_USDC_SAC_ID"));
    const tx = await baseTx(payer, usdc.call("balance", nativeToScVal(sisonke().contractId(), { type: "address" })));
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) fail(`USDC balance read failed: ${sim.error}`);
    return {
      locked: BigInt(await read("total_locked", [], payer)),
      balance: BigInt(scValToNative(sim.result!.retval)),
    };
  }

  /** After the attacks: the escrow is still `expected`, and no USDC moved. */
  async function expectUntouched(scenario: string, id: bigint, expected: string, before: { locked: bigint; balance: bigint }) {
    const status = statusName((await read("get_escrow", [u64(id)], payer)).escrow.status);
    const after = await funds();
    const same = after.locked === before.locked && after.balance === before.balance;
    record({
      scenario,
      step: `get_escrow #${id}, total_locked, contract balance`,
      signer: "anyone",
      method: "get_escrow",
      escrow_id: id.toString(),
      expected: `${expected}, funds unchanged`,
      result:
        `Still ${status}; total_locked ${before.locked} → ${after.locked}; ` +
        `contract USDC ${before.balance} → ${after.balance}`,
      hash: null,
      ledger: null,
      pass: status === expected && same,
    });
  }

  const now = await ledgerTime();
  const dayLater = now + 86_400;
  const createArgs = (title: string, deadline: number, withArbiter: boolean) => [
    addr(payer),
    addr(recipient),
    withArbiter ? addr(arbiter) : none(),
    i128(AMOUNT),
    u64(deadline),
    str(title),
    sha256(`Sisonke e2e scenario: ${title}`),
  ];
  const id1 = (id: bigint) => [u64(id)];

  console.log(`Contract ${sisonke().contractId()}\n`);

  // E and F have short deadlines; start them first so the waits overlap with A–D and G.
  // E. Dispute + split, part 1
  const eDeadline = (await ledgerTime()) + DISPUTE_SECONDS;
  const e = await expectSuccess("E", `create_and_fund (arbiter, ${DISPUTE_SECONDS}s)`, payer, "create_and_fund", createArgs("Dispute and split", eDeadline, true), "Funded");
  await expectSuccess("E", `dispute #${e}`, recipient, "dispute", [u64(e), addr(recipient)], "Disputed", e);
  await expectRejection("E", `resolve #${e} by stranger`, stranger, "resolve", [u64(e), i128(SPLIT)], e, "unauthorized", AUTH_ERROR);

  // F. Deadline reclaim, part 1
  const fDeadline = (await ledgerTime()) + RECLAIM_SECONDS;
  const f = await expectSuccess("F", `create_and_fund (${RECLAIM_SECONDS}s deadline)`, payer, "create_and_fund", createArgs("Deadline reclaim", fDeadline, false), "Funded");
  await expectRejection("F", `reclaim #${f} early`, payer, "reclaim", id1(f), f, "contract", contractError(103));

  // A. Two-step happy path
  const a = await expectSuccess("A", "create", payer, "create", createArgs("Two-step happy path", dayLater, false), "Created");
  await expectSuccess("A", `fund #${a}`, payer, "fund", id1(a), "Funded", a);
  await expectSuccess("A", `release #${a}`, payer, "release", id1(a), "Released", a);

  // B. Recipient refund
  const b = await expectSuccess("B", "create_and_fund", payer, "create_and_fund", createArgs("Recipient refund", dayLater, false), "Funded");
  await expectSuccess("B", `refund #${b}`, recipient, "refund", id1(b), "Refunded", b);

  // C. Unauthorized: a funded escrow with an arbiter, attacked six ways, then released.
  const c = await expectSuccess("C", "create_and_fund (arbiter)", payer, "create_and_fund", createArgs("Unauthorized", dayLater, true), "Funded");
  const cFunds = await funds();
  await expectRejection("C", `release #${c} by recipient`, recipient, "release", id1(c), c, "unauthorized", AUTH_ERROR);
  await expectRejection("C", `release #${c} by stranger`, stranger, "release", id1(c), c, "unauthorized", AUTH_ERROR);
  await expectRejection("C", `refund #${c} by payer`, payer, "refund", id1(c), c, "unauthorized", AUTH_ERROR);
  await expectRejection("C", `resolve #${c} by stranger`, stranger, "resolve", [u64(c), i128(AMOUNT)], c, "unauthorized", AUTH_ERROR);
  await expectRejection("C", `reclaim #${c} by recipient`, recipient, "reclaim", id1(c), c, "unauthorized", AUTH_ERROR);
  await expectRejection("C", "set_paused(true) by stranger", stranger, "set_paused", [nativeToScVal(true)], null, "unauthorized", AUTH_ERROR);
  await expectUntouched("C", c, "Funded", cFunds);
  await expectSuccess("C", `release #${c} by payer`, payer, "release", id1(c), "Released", c);

  // D. Duplicates: replay the original calls.
  await expectRejection("D", `release #${a} again`, payer, "release", id1(a), a, "duplicate", contractError(101));
  await expectRejection("D", `refund #${b} again`, recipient, "refund", id1(b), b, "duplicate", contractError(101));
  await expectRejection("D", `fund #${a} again`, payer, "fund", id1(a), a, "duplicate", contractError(101));

  // G. Cancel
  const g = await expectSuccess("G", "create", payer, "create", createArgs("Cancel", dayLater, false), "Created");
  await expectSuccess("G", `cancel #${g}`, payer, "cancel", id1(g), "Cancelled", g);
  await expectRejection("G", `fund #${g} after cancel`, payer, "fund", id1(g), g, "contract", contractError(101));

  // F, continued.
  await waitUntil(fDeadline, `escrow #${f}'s deadline`);
  await expectSuccess("F", `reclaim #${f}`, payer, "reclaim", id1(f), "Refunded", f);

  // E, continued: past the deadline, the dispute still blocks reclaim.
  await waitUntil(eDeadline, `escrow #${e}'s deadline`);
  await expectRejection("E", `reclaim #${e} after deadline`, payer, "reclaim", id1(e), e, "contract", contractError(101));
  await expectSuccess("E", `resolve #${e} (0.6 / 0.4)`, arbiter, "resolve", [u64(e), i128(SPLIT)], "Split", e);

  writeReports(keys, startedAt);
  if (rows.some((r) => !r.pass)) process.exit(1);
}

// -------------------------------------------------------------------- main

const command = process.argv[2];
if (command === "setup") await setup();
else if (!command) await run();
else fail(`Unknown command "${command}". Use: node e2e.ts [setup]`);
