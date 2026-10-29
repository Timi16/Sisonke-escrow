/**
 * Node-side Testnet helpers for the e2e scripts: Horizon reads, Friendbot,
 * USDC from the funder, Sisonke calls signed in Node, and the run report.
 * Secret keys stay in this process; the browser only ever gets addresses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ROOT = path.resolve(WEB, "..");
export const OUT = path.join(WEB, "e2e/.out");

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    let v = t.slice(t.indexOf("=") + 1);
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    out[t.slice(0, t.indexOf("="))] = v;
  }
  return out;
}

const deployment = parseEnv(path.join(ROOT, "deployments/testnet.env"));
export const PASSPHRASE = deployment.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
export const RPC_URL = deployment.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const HORIZON_URL = deployment.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
export const CONTRACT_ID = deployment.NEXT_PUBLIC_SISONKE_CONTRACT_ID;
export const USDC = new Asset("USDC", deployment.NEXT_PUBLIC_USDC_ISSUER ?? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const horizon = new Horizon.Server(HORIZON_URL);
export const server = new rpc.Server(RPC_URL);
const sisonke = new Contract(CONTRACT_ID);

/** The funder: E2E_FUNDER_SECRET, else E2E_PAYER_SECRET from ../scripts/.env. Null if neither. */
export function funder() {
  const keys = parseEnv(path.join(ROOT, "scripts/.env"));
  const secret = process.env.E2E_FUNDER_SECRET ?? keys.E2E_FUNDER_SECRET ?? keys.E2E_PAYER_SECRET;
  return secret ? Keypair.fromSecret(secret) : null;
}

// ------------------------------------------------------------ amounts (no floats)

export const toStroops = (s) => {
  const [w, f = ""] = String(s).split(".");
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, "0").slice(0, 7));
};
export const fromStroops = (n) => {
  const v = BigInt(n);
  return `${v / 10_000_000n}.${(v % 10_000_000n).toString().padStart(7, "0")}`;
};

// ------------------------------------------------------------ Horizon

export async function accountExists(address) {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  return res.ok;
}

/** USDC balance in stroops, or null without a trustline (or account). */
export async function usdcOf(address) {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (!res.ok) return null;
  const acc = await res.json();
  const line = acc.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer);
  return line ? toStroops(line.balance) : null;
}

export async function friendbot(address) {
  if (await accountExists(address)) return;
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!res.ok && !(await accountExists(address))) throw new Error(`Friendbot failed for ${address}: ${res.status}`);
}

export async function classic(kp, op) {
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(60).build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

export const addTrustline = (kp) => classic(kp, Operation.changeTrust({ asset: USDC }));

/** Pays `amount` (a 7-decimal string) of USDC. */
export const payUsdc = (from, to, amount) => classic(from, Operation.payment({ destination: to, asset: USDC, amount }));

// ------------------------------------------------------------ Sisonke

export const sc = {
  u64: (n) => nativeToScVal(BigInt(n), { type: "u64" }),
  i128: (n) => nativeToScVal(BigInt(n), { type: "i128" }),
  address: (a) => nativeToScVal(a, { type: "address" }),
  string: (s) => nativeToScVal(s, { type: "string" }),
  none: () => xdr.ScVal.scvVoid(),
};

export const createArgs = ({ payer, recipient, arbiter = null, amount, deadline, title = "" }) => [
  sc.address(payer),
  sc.address(recipient),
  arbiter ? sc.address(arbiter) : sc.none(),
  sc.i128(amount),
  sc.u64(deadline),
  sc.string(title),
  sc.none(),
];

/** Simulate, assemble, sign as `kp` (the source and only signer), send, poll. */
export async function invoke(kp, method, args) {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(sisonke.call(method, ...args))
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method} refused in simulation: ${sim.error.split("\n")[0]}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(`${method} not accepted: ${sent.status}`);
  const res = await server.pollTransaction(sent.hash, { attempts: 60 });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method} ${res.status} (${sent.hash})`);
  return { hash: sent.hash, ledger: res.ledger, value: res.returnValue ? scValToNative(res.returnValue) : undefined };
}

/** Simulation only (no signature): the raw error text, or null if it would succeed. */
export async function simulate(source, method, args) {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(sisonke.call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  return rpc.Api.isSimulationError(sim) ? sim.error : null;
}

export async function ledgerTime() {
  return Number((await server.getLatestLedger()).closeTime);
}

/** get_escrow through the app's own API (so the dev server is exercised too). */
export async function escrowViaApi(id) {
  const res = await fetch(`${BASE}/api/escrow/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/escrow/${id} → ${res.status}`);
  return res.json();
}

export async function infoViaApi() {
  const res = await fetch(`${BASE}/api/info`);
  if (!res.ok) throw new Error(`GET /api/info → ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------ report

const rows = [];

/** One transaction the app showed: { step, escrowId, method, hash, ok }. */
export function recordTx(row) {
  rows.push({ ...row, escrowId: row.escrowId == null ? null : String(row.escrowId) });
}

/** The rows recorded so far. */
export const txRows = () => rows;

export function writeRun(extra = {}) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "run.json");
  writeFileSync(file, `${JSON.stringify({ base: BASE, contractId: CONTRACT_ID, at: new Date().toISOString(), ...extra, transactions: rows }, null, 2)}\n`);
  return file;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
