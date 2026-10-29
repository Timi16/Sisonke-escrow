/**
 * Admin operations on sisonke-escrow, signed by the admin's own signers. The
 * admin is a native Stellar multisig account (scripts/multisig-admin.sh).
 *
 * One process (Testnet convenience: every signer key is on this machine):
 *   node admin.ts status                         # key=value lines: admin, delay, pending upgrade, ledger time
 *   node admin.ts propose <wasm-hash> --signers a,b
 *   node admin.ts execute --signers a,b          # upgrade(<pending hash>) between eta and expires_at
 *   node admin.ts cancel --signers a,b
 *   node admin.ts set-delay <seconds> --signers a,b
 *   node admin.ts lock --signers a,b
 *
 * Independent signers (each key stays on its owner's device):
 *   node admin.ts prepare <propose <hash>|execute|cancel|set-delay <s>|lock> --out req.json
 *   node admin.ts sign req.json --key <identity>      # or --key - to read the secret from stdin
 *   node admin.ts submit req.json                      # sorts the signatures, simulates, sends
 *   `prepare` needs the network; `sign` doesn't (it recomputes what it signs from the
 *   request's auth entry and network passphrase, and prints it first); `submit` does.
 *
 * Options (flag, or env var in brackets):
 *   --env-file <path>     [ADMIN_ENV_FILE] deployment file, default deployments/testnet.env
 *   --contract <C…>       [ADMIN_CONTRACT_ID] default NEXT_PUBLIC_SISONKE_CONTRACT_ID from the env file
 *   --signers <a,b,…>     [ADMIN_SIGNERS] stellar CLI identities of the admin's signers (one-process mode)
 *   --fee-payer <name>    [ADMIN_FEE_PAYER] identity paying the fee, default sisonke-deployer
 *   --valid-ledgers <n>   how long the authorization stays valid, default 100 (one process) or
 *                         17280 (~1 day, prepare) ledgers
 *   --expected <hash>     execute only: the hash to commit to, default the pending one
 *   --expect-failure      the call is meant to be refused: submit it anyway so the refusal is on-chain,
 *                         and exit 0 only if the network refused it
 * Secret keys are never accepted on the command line (they'd land in shell history and `ps`).
 *
 * How it signs (verified in soroban-env-host 29, see docs/UPGRADES.md "Multisig admin"):
 * the fee payer is the transaction source, and the admin authorizes the call with an
 * address-credential auth entry whose signature is a vector of {public_key, signature}
 * pairs, one per signer, sorted by public key. The host adds up the signers' weights on
 * the admin account and requires at least its MEDIUM threshold. Because the transaction
 * itself is valid either way, an under-signed call is included in a ledger and fails
 * there, which leaves a verifiable failed transaction.
 *
 * Prints one JSON line: {"command","ok","hash","ledger","error","simulated"}.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  authorizeEntry,
  authorizeInvocation,
  buildAuthorizationEntryPreimage,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";

// ------------------------------------------------------------------ config

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--expect-failure") flags.set("expect-failure", "1");
  else if (a.startsWith("--")) flags.set(a.slice(2), argv[++i] ?? "");
  else positional.push(a);
}
const opt = (flag: string, env: string, fallback?: string) => flags.get(flag) ?? process.env[env] ?? fallback;

const ENV_FILE = path.resolve(ROOT, opt("env-file", "ADMIN_ENV_FILE", "deployments/testnet.env")!);
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = opt("contract", "ADMIN_CONTRACT_ID", process.env.NEXT_PUBLIC_SISONKE_CONTRACT_ID);
const SIGNERS = (opt("signers", "ADMIN_SIGNERS", "") ?? "").split(",").filter(Boolean);
const FEE_PAYER = opt("fee-payer", "ADMIN_FEE_PAYER", "sisonke-deployer")!;
const EXPECT_FAILURE = flags.has("expect-failure");

const server = new rpc.Server(RPC_URL);

/** Contract error names (contracts/sisonke-escrow/src/errors.rs), plus the account contract's 5. */
const ERROR_NAMES: Record<number, string> = {
  5: "AuthenticationError (signer weights below the admin account's threshold)",
  141: "MigrationRequired",
  143: "Overflow",
  200: "UpgradesLocked",
  202: "InvalidUpgradeDelay",
  203: "NoPendingUpgrade",
  204: "UpgradeTooEarly",
  205: "UpgradeDelayDecrease",
  206: "UpgradeHashMismatch",
  207: "UpgradeExpired",
};

// ------------------------------------------------------------- helpers

/** A secret key for a stellar CLI identity. Secrets on argv are refused. */
function secretOf(name: string): string {
  if (/^S[A-Z2-7]{55}$/.test(name)) {
    fail("Don't pass secret keys on the command line. Use a stellar CLI identity, or `sign --key -` to read one from stdin.");
  }
  try {
    return execFileSync("stellar", ["keys", "secret", name], { encoding: "utf8" }).trim();
  } catch {
    fail(`No stellar CLI identity '${name}' (stellar keys ls)`);
  }
}

/** The admin's signer keys for one-process mode: distinct identities and distinct keys. */
function signerKeys(): Keypair[] {
  if (!SIGNERS.length) fail("Pass the admin's signers: --signers name1,name2 (or ADMIN_SIGNERS)");
  const dupName = SIGNERS.find((n, i) => SIGNERS.indexOf(n) !== i);
  if (dupName) fail(`Signer '${dupName}' is listed twice; each signer can sign only once.`);
  const keys = SIGNERS.map((n) => Keypair.fromSecret(secretOf(n)));
  const pks = keys.map((k) => k.publicKey());
  const dupKey = pks.find((k, i) => pks.indexOf(k) !== i);
  if (dupKey) fail(`Two of the signers are the same key ${dupKey}; each signer can sign only once.`);
  return keys;
}

function describeError(raw: string): string {
  const contract = raw.match(/Error\(Contract, #(\d+)\)/);
  if (contract) {
    const code = Number(contract[1]);
    return `Error #${code} ${ERROR_NAMES[code] ?? ""}`.trim();
  }
  const auth = raw.match(/Error\(Auth, (\w+)\)/);
  if (auth) return `Auth error (${auth[1]})`;
  return raw.split("\n")[0].slice(0, 160);
}

/** The error the network recorded, from the `host_fn_failed` diagnostic event. */
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
    if (err.contractCode !== undefined) {
      return `Error #${err.contractCode} ${ERROR_NAMES[err.contractCode] ?? ""}`.trim();
    }
    return err.type === 9 ? `Auth error (code ${err.code})` : `Host error (type ${err.type}, code ${err.code})`;
  }
  return undefined;
}

async function baseTx(source: Keypair | string, op: xdr.Operation): Promise<Transaction> {
  const id = typeof source === "string" ? source : source.publicKey();
  const account = await server.getAccount(id);
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(120)
    .build();
}

let contractClient: Contract | undefined;
const sisonke = (): Contract => {
  if (!CONTRACT_ID) fail(`No contract id: pass --contract or deploy first (${ENV_FILE})`);
  return (contractClient ??= new Contract(CONTRACT_ID));
};

/** Read-only call through simulation, from any existing account. */
async function read(source: string, method: string, args: xdr.ScVal[] = []): Promise<any> {
  const sim = await server.simulateTransaction(await baseTx(source, sisonke().call(method, ...args)));
  if (rpc.Api.isSimulationError(sim)) fail(`${method} failed: ${describeError(sim.error)}`);
  return scValToNative(sim.result!.retval);
}

/**
 * Whether this network records `SOROBAN_CREDENTIALS_ADDRESS_V2` (CAP-71) auth
 * entries. Read from a recording simulation of an admin call rather than
 * assumed from the SDK version.
 */
async function networkUsesAuthV2(source: string, method: string, args: xdr.ScVal[]): Promise<boolean> {
  const probes: Array<[string, xdr.ScVal[]]> = [
    [method, args],
    ["set_upgrade_delay", [nativeToScVal(BigInt(await read(source, "upgrade_delay")), { type: "u64" })]],
  ];
  for (const [m, a] of probes) {
    const sim = await server.simulateTransaction(await baseTx(source, sisonke().call(m, ...a)));
    if (rpc.Api.isSimulationError(sim)) continue;
    const entry = sim.result?.auth?.[0];
    if (entry) return entry.credentials.type !== "sorobanCredentialsAddress";
  }
  return true;
}

type Sig = { public_key: string; signature: string };

/** The account-contract signature: one {public_key, signature} map per signer, sorted by key. */
function signatureVector(sigs: Sig[]): xdr.ScVal {
  const sorted = [...sigs].sort((a, b) => Buffer.compare(Buffer.from(a.public_key, "hex"), Buffer.from(b.public_key, "hex")));
  return xdr.ScVal.scvVec(
    sorted.map((s) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("public_key"), val: xdr.ScVal.scvBytes(Buffer.from(s.public_key, "hex")) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(Buffer.from(s.signature, "hex")) }),
      ]),
    ),
  );
}

function addressCredentials(entry: xdr.SorobanAuthorizationEntry): { address: string; nonce: bigint; expiration: number } {
  const value = (entry.credentials as any).value;
  if (!value?.address) fail("The auth entry has no address credentials");
  return {
    address: Address.fromScAddress(value.address).toString(),
    nonce: BigInt(value.nonce),
    expiration: Number(value.signatureExpirationLedger),
  };
}

/** The payload a signer signs, recomputed from the entry alone. */
function payloadOf(entry: xdr.SorobanAuthorizationEntry, expiration: number, passphrase: string): Buffer {
  return Buffer.from(hash(Buffer.from(buildAuthorizationEntryPreimage(entry, expiration, passphrase).toXDR())));
}

/** Contract, function and arguments an entry authorizes, decoded from the entry itself. */
function describeEntry(entry: xdr.SorobanAuthorizationEntry): { contract: string; fn: string; args: string[] } {
  const fnValue = (entry.rootInvocation.function as any).value;
  const show = (v: xdr.ScVal): string => {
    const n = scValToNative(v);
    if (n instanceof Uint8Array) return `bytes ${Buffer.from(n).toString("hex")}`;
    return typeof n === "bigint" ? n.toString() : JSON.stringify(n);
  };
  return {
    contract: Address.fromScAddress(fnValue.contractAddress).toString(),
    fn: String(fnValue.functionName),
    args: (fnValue.args as xdr.ScVal[]).map(show),
  };
}

/**
 * Footprint for a call that can't be simulated successfully (it is meant to
 * fail): a read's footprint (instance and code), plus the admin account entry
 * the host loads to check signer weights and the auth entry's nonce entry.
 */
async function failureData(source: string, admin: string, nonce: bigint): Promise<xdr.SorobanTransactionData> {
  const probe = await server.simulateTransaction(await baseTx(source, sisonke().call("upgrade_delay")));
  if (rpc.Api.isSimulationError(probe)) fail(`probe failed: ${probe.error}`);
  const probed = probe.transactionData.build();
  const res = probed.resources;
  const account = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(admin).xdrPublicKey() }));
  const nonceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(admin).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyNonce(new xdr.ScNonceKey({ nonce })),
      durability: xdr.ContractDataDurability.temporary,
    }),
  );
  return new SorobanDataBuilder(probed)
    .appendFootprint([account], [nonceKey])
    .setResources(res.instructions * 4 + 5_000_000, res.diskReadBytes + 20_000, res.writeBytes + 10_000)
    .setResourceFee(BigInt(probed.resourceFee) * 4n + 2_000_000n)
    .build();
}

type Outcome = { command: string; ok: boolean; hash: string | null; ledger: number | null; error: string | null; simulated: string };

async function send(tx: Transaction): Promise<{ ok: boolean; hash: string; ledger: number | null; error: string | null }> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    return { ok: false, hash: sent.hash, ledger: null, error: `not accepted: ${sent.status}` };
  }
  const res = await server.pollTransaction(sent.hash, { attempts: 60 });
  if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return { ok: true, hash: sent.hash, ledger: res.ledger, error: null };
  }
  if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
    return { ok: false, hash: sent.hash, ledger: res.ledger, error: chainError(res.diagnosticEventsXdr) ?? "failed on-chain" };
  }
  return { ok: false, hash: sent.hash, ledger: null, error: `not confirmed: ${res.status}` };
}

// ------------------------------------------------------- the admin calls

type Call = { method: string; args: xdr.ScVal[] };

/** Contract method and arguments for an admin command. */
async function callFor(command: string | undefined, arg: string | undefined, source: string): Promise<Call> {
  switch (command) {
    case "propose":
      if (!/^[0-9a-f]{64}$/.test(arg ?? "")) fail("usage: propose <64-hex wasm hash>");
      return { method: "propose_upgrade", args: [xdr.ScVal.scvBytes(Buffer.from(arg!, "hex"))] };
    case "execute": {
      const pending = await read(source, "pending_upgrade");
      if (!pending) fail("No upgrade is pending.");
      const wasmHash = Buffer.from(pending.wasm_hash).toString("hex");
      const now = Number((await server.getLatestLedger()).closeTime);
      console.error(`pending upgrade: ${wasmHash}`);
      console.error(`eta:             ${pending.eta} (ledger time now ${now})`);
      console.error(`expires_at:      ${pending.expires_at}`);
      // --expected overrides the hash the signatures commit to (the demo uses
      // it to show that a different hash is refused).
      const expected = flags.get("expected") ?? wasmHash;
      if (!/^[0-9a-f]{64}$/.test(expected)) fail("--expected must be a 64-hex wasm hash");
      if (expected !== wasmHash) console.error(`signing for:     ${expected} (NOT the pending hash)`);
      return { method: "upgrade", args: [xdr.ScVal.scvBytes(Buffer.from(expected, "hex"))] };
    }
    case "cancel":
      return { method: "cancel_upgrade", args: [] };
    case "set-delay":
      if (!/^[0-9]+$/.test(arg ?? "")) fail("usage: set-delay <seconds>");
      return { method: "set_upgrade_delay", args: [nativeToScVal(BigInt(arg!), { type: "u64" })] };
    case "lock":
      return { method: "lock_upgrades", args: [] };
    default:
      fail(`Unknown admin command "${command ?? ""}". Use: propose <hash> | execute | cancel | set-delay <s> | lock`);
  }
}

/** An unsigned address-credential auth entry for the admin, and what to sign. */
async function unsignedEntry(source: string, call: Call, validLedgers: number) {
  const admin: string = await read(source, "admin");
  const latest = await server.getLatestLedger();
  const authV2 = await networkUsesAuthV2(source, call.method, call.args);
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(sisonke().contractId()).toScAddress(),
        functionName: call.method,
        args: call.args,
      }),
    ),
    subInvocations: [],
  });
  let payload: Buffer | undefined;
  const entry = await authorizeInvocation({
    signer: async (_preimage, p) => {
      payload = Buffer.from(p);
      return { signatureScVal: xdr.ScVal.scvVoid() };
    },
    validUntilLedgerSeq: latest.sequence + validLedgers,
    invocation,
    networkPassphrase: PASSPHRASE,
    publicKey: admin,
    authV2,
  });
  return { admin, entry, payload: payload!, expiration: latest.sequence + validLedgers };
}

/** Puts the collected signatures into the entry, then simulates (enforcing) and sends. */
async function submitEntry(command: string, unsigned: xdr.SorobanAuthorizationEntry, sigs: Sig[], passphrase: string): Promise<Outcome> {
  const feePayer = Keypair.fromSecret(secretOf(FEE_PAYER));
  const { address: admin, nonce, expiration } = addressCredentials(unsigned);
  const entry = await authorizeEntry(unsigned, async () => ({ signatureScVal: signatureVector(sigs) }), expiration, passphrase);
  const { fn, args } = (() => {
    const v = (entry.rootInvocation.function as any).value;
    return { fn: String(v.functionName), args: v.args as xdr.ScVal[] };
  })();
  const op = Operation.invokeContractFunction({ contract: sisonke().contractId(), function: fn, args, auth: [entry] });

  // Enforcing simulation checks the real signatures, so it also gives exact
  // resources for the extra signature checks.
  const sim = await server.simulateTransaction(await baseTx(feePayer, op), undefined, "enforce");
  let data: xdr.SorobanTransactionData;
  let simulated: string;
  if (rpc.Api.isSimulationError(sim)) {
    simulated = describeError(sim.error);
    if (!EXPECT_FAILURE) return { command, ok: false, hash: null, ledger: null, error: simulated, simulated };
    data = await failureData(feePayer.publicKey(), admin, nonce);
  } else {
    simulated = "ok";
    data = sim.transactionData.build();
  }
  const account = await server.getAccount(feePayer.publicKey());
  // The builder adds the resource fee to this inclusion fee.
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(op)
    .setSorobanData(data)
    .setTimeout(120)
    .build();
  tx.sign(feePayer);
  const sent = await send(tx);
  return { command, ok: sent.ok, hash: sent.hash, ledger: sent.ledger, error: sent.error, simulated };
}

function signWith(kp: Keypair, payload: Buffer): Sig {
  return {
    public_key: Buffer.from(kp.rawPublicKey()).toString("hex"),
    signature: Buffer.from(kp.sign(payload)).toString("hex"),
  };
}

// ---------------------------------------------------- the request file

type Request = {
  format: "sisonke-admin-request/1";
  command: string;
  network_passphrase: string;
  contract: string;
  admin: string;
  entry: string;
  expiration_ledger: number;
  payload: string;
  signatures: Sig[];
};

function loadRequest(file: string | undefined): Request {
  if (!file || !existsSync(file)) fail(`No request file '${file ?? ""}'`);
  const req = JSON.parse(readFileSync(file, "utf8")) as Request;
  if (req.format !== "sisonke-admin-request/1") fail(`${file} is not a sisonke admin request`);
  return req;
}

async function prepare(op: string | undefined, arg: string | undefined) {
  const out = flags.get("out");
  if (!out) fail("usage: prepare <op> [arg] --out req.json");
  const feePayer = Keypair.fromSecret(secretOf(FEE_PAYER)).publicKey();
  const call = await callFor(op, arg, feePayer);
  const valid = Number(flags.get("valid-ledgers") ?? 17_280);
  const { admin, entry, payload, expiration } = await unsignedEntry(feePayer, call, valid);
  const req: Request = {
    format: "sisonke-admin-request/1",
    command: op!,
    network_passphrase: PASSPHRASE,
    contract: sisonke().contractId(),
    admin,
    entry: entry.toXDR("base64"),
    expiration_ledger: expiration,
    payload: payload.toString("hex"),
    signatures: [],
  };
  writeFileSync(out, `${JSON.stringify(req, null, 2)}\n`);
  console.error(`Wrote ${out}: ${call.method} on ${req.contract} for admin ${admin}, valid until ledger ${expiration}.`);
  console.error(`Each signer runs: node admin.ts sign ${out} --key <identity>   (or --key - with the secret on stdin)`);
}

function sign(file: string | undefined) {
  const req = loadRequest(file);
  const keyArg = flags.get("key");
  if (!keyArg) fail("usage: sign req.json --key <identity>   (or --key - to read the secret from stdin)");
  const secret = keyArg === "-" ? readFileSync(0, "utf8").trim() : secretOf(keyArg);
  const kp = Keypair.fromSecret(secret);

  // Everything shown and signed comes from the entry and the passphrase, not
  // from the request's own summary fields.
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(req.entry, "base64");
  const { address, expiration } = addressCredentials(entry);
  const what = describeEntry(entry);
  const payload = payloadOf(entry, expiration, req.network_passphrase);
  if (payload.toString("hex") !== req.payload) fail("The request's payload doesn't match its auth entry; refusing to sign.");
  if (what.contract !== req.contract || address !== req.admin) fail("The request's summary doesn't match its auth entry; refusing to sign.");
  console.error("You are signing, as one of the admin's signers:");
  console.error(`  network:   ${req.network_passphrase}`);
  console.error(`  contract:  ${what.contract}`);
  console.error(`  admin:     ${address}`);
  console.error(`  call:      ${what.fn}(${what.args.join(", ")})`);
  console.error(`  valid to:  ledger ${expiration}`);
  console.error(`  signer:    ${kp.publicKey()}`);

  const sig = signWith(kp, payload);
  if (req.signatures.some((s) => s.public_key === sig.public_key)) fail(`${kp.publicKey()} has already signed this request.`);
  req.signatures.push(sig);
  writeFileSync(file!, `${JSON.stringify(req, null, 2)}\n`);
  console.error(`Signed. ${req.signatures.length} signature(s) in ${file}.`);
}

async function submit(file: string | undefined): Promise<Outcome> {
  const req = loadRequest(file);
  if (req.network_passphrase !== PASSPHRASE) fail(`${file} is for "${req.network_passphrase}", not "${PASSPHRASE}"`);
  if (req.contract !== sisonke().contractId()) fail(`${file} is for ${req.contract}, not ${sisonke().contractId()}`);
  const keys = req.signatures.map((s) => s.public_key);
  if (new Set(keys).size !== keys.length) fail(`${file} has the same signer twice.`);
  if (!keys.length) fail(`${file} has no signatures yet.`);
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(req.entry, "base64");
  return submitEntry(req.command, entry, req.signatures, req.network_passphrase);
}

/** One-process mode: prepare, sign with every local signer, submit. */
async function adminCall(command: string, arg: string | undefined): Promise<Outcome> {
  const keys = signerKeys();
  const feePayer = Keypair.fromSecret(secretOf(FEE_PAYER)).publicKey();
  const call = await callFor(command, arg, feePayer);
  const valid = Number(flags.get("valid-ledgers") ?? 100);
  const { entry, payload } = await unsignedEntry(feePayer, call, valid);
  return submitEntry(command, entry, keys.map((k) => signWith(k, payload)), PASSPHRASE);
}

async function status() {
  const source = Keypair.fromSecret(secretOf(FEE_PAYER)).publicKey();
  const pending = await read(source, "pending_upgrade");
  const lines: Record<string, unknown> = {
    contract: sisonke().contractId(),
    admin: await read(source, "admin"),
    version: await read(source, "version"),
    storage_version: await read(source, "storage_version"),
    upgrades_enabled: await read(source, "upgrades_enabled"),
    upgrade_delay: await read(source, "upgrade_delay"),
    pending_hash: pending ? Buffer.from(pending.wasm_hash).toString("hex") : "",
    pending_eta: pending ? pending.eta : "",
    pending_expires_at: pending ? pending.expires_at : "",
    ledger_time: (await server.getLatestLedger()).closeTime,
  };
  for (const [k, v] of Object.entries(lines)) console.log(`${k}=${v}`);
}

// -------------------------------------------------------------------- main

const [command, arg, arg2] = positional;
let outcome: Outcome | undefined;
switch (command) {
  case "status":
    await status();
    break;
  case "prepare":
    await prepare(arg, arg2);
    break;
  case "sign":
    sign(arg);
    break;
  case "submit":
    outcome = await submit(arg);
    break;
  default:
    outcome = await adminCall(command ?? "", arg);
}
if (outcome) {
  console.log(JSON.stringify(outcome));
  const succeeded = EXPECT_FAILURE ? !outcome.ok && outcome.hash !== null : outcome.ok;
  process.exit(succeeded ? 0 : 1);
}
