/**
 * Public runtime config. Every value is public, so no secrets live here.
 * Defaults are the live Testnet deployment (lib/generated/deployment.ts,
 * written by `pnpm sync` from ../deployments/testnet.env), so the app runs
 * with no .env at all. NEXT_PUBLIC_* overrides them at build time.
 *
 * Each process.env read is spelled out in full: Next inlines only literal
 * `process.env.NEXT_PUBLIC_X` references into the browser bundle.
 */
import { StrKey } from "@stellar/stellar-sdk";
import { deployment as d } from "./generated/deployment";

export const config = {
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? d.NEXT_PUBLIC_STELLAR_NETWORK,
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? d.NEXT_PUBLIC_NETWORK_PASSPHRASE,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? d.NEXT_PUBLIC_RPC_URL,
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? d.NEXT_PUBLIC_HORIZON_URL,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? d.NEXT_PUBLIC_EXPLORER_URL,
  contractId: process.env.NEXT_PUBLIC_SISONKE_CONTRACT_ID ?? d.NEXT_PUBLIC_SISONKE_CONTRACT_ID,
  usdcSacId: process.env.NEXT_PUBLIC_USDC_SAC_ID ?? d.NEXT_PUBLIC_USDC_SAC_ID,
  usdcIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER ?? d.NEXT_PUBLIC_USDC_ISSUER,
  deployLedger: Number(process.env.NEXT_PUBLIC_SISONKE_DEPLOY_LEDGER ?? d.NEXT_PUBLIC_SISONKE_DEPLOY_LEDGER),
  deployTx: d.SISONKE_DEPLOY_TX,
  wasmHash: d.SISONKE_WASM_HASH,
  sourceRev: d.SISONKE_SOURCE_REV,
  /** Empty when unset: links to the repo are hidden then. */
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "",
  friendbotUrl: "https://friendbot.stellar.org",
  usdcFaucetUrl: "https://faucet.circle.com",
  labUrl: "https://lab.stellar.org",
} as const;

const HASH = /^[0-9a-f]{64}$/i;

/** Explorer links. Each validates its input and throws on anything else. */
export const explorer = {
  tx(hash: string): string {
    if (!HASH.test(hash)) throw new Error("Not a transaction hash");
    return `${config.explorerUrl}/tx/${hash.toLowerCase()}`;
  },
  account(address: string): string {
    if (!StrKey.isValidEd25519PublicKey(address)) throw new Error("Not a Stellar account");
    return `${config.explorerUrl}/account/${address}`;
  },
  contract(id: string = config.contractId): string {
    if (!StrKey.isValidContract(id)) throw new Error("Not a contract id");
    return `${config.explorerUrl}/contract/${id}`;
  },
};

/** Repo links (hidden when NEXT_PUBLIC_REPO_URL is unset). */
export function repoLink(pathname = ""): string | null {
  if (!config.repoUrl || !/^https:\/\//.test(config.repoUrl)) return null;
  return `${config.repoUrl.replace(/\/$/, "")}${pathname}`;
}

export const USDC_DECIMALS = 7;
export const MAX_BATCH = 20;
export const PAGE_SIZE = 50;
export const MAX_TITLE_BYTES = 64;
export const MAX_DURATION = 365 * 86_400;
/** Disputes stop being offered this many seconds before the deadline. */
export const DISPUTE_CUTOFF = 600;
/** A custom deadline must be at least this far after ledger time. */
export const MIN_DEADLINE_LEAD = 120;
/** Margin under MAX_DURATION so simulation and submission stay in bounds. */
export const MAX_DEADLINE_MARGIN = 300;
export const SPAM_MIN_AMOUNT = 100_000n;
export const SPAM_SHORT_LIFE = 3600;
export const TTL_BUMP_AGE = 60 * 86_400;
/** Newest ids the dashboard reads per role before "Show older escrows". */
export const DASHBOARD_WINDOW = 100;

/** Explorer link for an account (G…) or contract (C…); null for anything else, so render never throws. */
export function addressLink(address: string): string | null {
  try {
    return StrKey.isValidContract(address) ? explorer.contract(address) : explorer.account(address);
  } catch {
    return null;
  }
}
