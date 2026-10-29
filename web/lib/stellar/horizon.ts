/** Horizon reads: balances, trustlines and DEX quotes. Balances stay strings. */
import { Asset, Horizon } from "@stellar/stellar-sdk";
import { config } from "../config";

export const USDC = new Asset("USDC", config.usdcIssuer);

export interface Readiness {
  /** The account exists (has been funded with XLM). */
  exists: boolean;
  xlm: string | null;
  /** Null when there is no USDC trustline. `authorized` false means frozen. */
  usdc: { balance: string; authorized: boolean } | null;
}

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  is_authorized?: boolean;
}

export async function getReadiness(address: string): Promise<Readiness> {
  // `?signer=` answers 200 with an empty list for an unfunded account, where
  // /accounts/:id answers 404, which browsers log as a console error on every poll.
  const res = await fetch(`${config.horizonUrl}/accounts?signer=${encodeURIComponent(address)}&limit=200`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Horizon responded ${res.status}`);
  const page = (await res.json()) as { _embedded: { records: { id: string; balances: HorizonBalance[] }[] } };
  // Other accounts can list this key as a signer; only its own account counts.
  const account = page._embedded.records.find((r) => r.id === address);
  if (!account) return { exists: false, xlm: null, usdc: null };
  const xlm = account.balances.find((b) => b.asset_type === "native")?.balance ?? null;
  const line = account.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === config.usdcIssuer);
  return {
    exists: true,
    xlm,
    usdc: line ? { balance: line.balance, authorized: line.is_authorized !== false } : null,
  };
}

export interface UsdcPath {
  /** XLM the DEX quotes for the USDC asked for, as Horizon's 7-decimal string. */
  sourceAmount: string;
  path: Asset[];
}

/** Cheapest XLM → USDC path for `destAmount` (a 7-decimal string), or null. */
export async function findUsdcPath(destAmount: string): Promise<UsdcPath | null> {
  const horizon = new Horizon.Server(config.horizonUrl);
  const res = await horizon.strictReceivePaths([Asset.native()], USDC, destAmount).call();
  const native = res.records.filter((r) => r.source_asset_type === "native");
  if (!native.length) return null;
  const toStroops = (s: string) => {
    const [w, f = ""] = s.split(".");
    return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, "0").slice(0, 7));
  };
  const best = native.reduce((a, b) => (toStroops(b.source_amount) < toStroops(a.source_amount) ? b : a));
  return {
    sourceAmount: best.source_amount,
    path: best.path.map((p) =>
      p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code as string, p.asset_issuer as string),
    ),
  };
}
