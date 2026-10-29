/**
 * Contract reads through simulation. Runs in the browser (live, via React
 * Query) and on the server (API routes), so it only touches public RPC.
 */
import { Contract } from "@stellar/stellar-sdk";
import { MAX_BATCH, PAGE_SIZE, config } from "../config";
import { SimulationError, server, view, viewOn, withRetry } from "../stellar/rpc";
import { encode, sc } from "./contract";
import { decodeEscrowView, decodeInfo } from "./decode";
import { contractCode } from "./errors";
import type { ContractInfo, EscrowView, PartyRole } from "./types";
import { xdr } from "@stellar/stellar-sdk";

export async function getInfo(): Promise<ContractInfo> {
  return decodeInfo(await view("info"));
}

/** One escrow, or null if the id doesn't exist (error 100). */
export async function getEscrow(id: bigint): Promise<EscrowView | null> {
  try {
    return decodeEscrowView(await view("get_escrow", encode.id(id)));
  } catch (err) {
    if (err instanceof SimulationError && contractCode(err.message) === 100) return null;
    throw err;
  }
}

/** Batch read in the given order, in chunks of MAX_BATCH; unknown ids are skipped. */
export async function getEscrows(ids: bigint[]): Promise<EscrowView[]> {
  const chunks: bigint[][] = [];
  for (let i = 0; i < ids.length; i += MAX_BATCH) chunks.push(ids.slice(i, i + MAX_BATCH));
  const results = await Promise.all(
    chunks.map(async (chunk) => ((await view("get_escrows", encode.getEscrows(chunk))) as unknown[]).map(decodeEscrowView)),
  );
  return results.flat();
}

export async function partyCount(party: string, role: PartyRole): Promise<number> {
  return Number(await view("party_escrow_count", encode.partyCount(party, role)));
}

export async function partyPage(party: string, role: PartyRole, page: number): Promise<bigint[]> {
  return ((await view("party_escrow_ids", encode.partyIds(party, role, page))) as bigint[]).map((x) => BigInt(x));
}

/**
 * The newest `limit` ids for a party in a role, newest first, skipping the
 * newest `skip`. Reads only the pages that hold them.
 */
export async function newestIds(party: string, role: PartyRole, count: number, limit: number, skip = 0): Promise<bigint[]> {
  const end = count - skip; // exclusive index of the newest wanted
  const start = Math.max(0, end - limit);
  if (end <= 0) return [];
  const pages: number[] = [];
  for (let p = Math.floor(start / PAGE_SIZE); p <= Math.floor((end - 1) / PAGE_SIZE); p++) pages.push(p);
  const lists = await Promise.all(pages.map((p) => partyPage(party, role, p)));
  const flat = lists.flat();
  const offset = pages[0] * PAGE_SIZE;
  return flat.slice(start - offset, end - offset).reverse();
}

/** The USDC SAC's balance of an address (the Sisonke contract, for "About"). */
export async function sacBalance(address: string): Promise<bigint> {
  return BigInt((await viewOn(new Contract(config.usdcSacId), "balance", [sc.address(address)])) as bigint);
}

/** Whether a wasm with this hash has been uploaded (so it can be reviewed). */
export async function codeExists(hashHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(hashHex)) return false;
  // LedgerKey::ContractCode = discriminant 7 (int32) + the 32-byte hash. Built
  // as XDR bytes so it needs no Buffer global in the browser.
  const bytes = [0, 0, 0, 7, ...(hashHex.match(/../g) ?? []).map((h) => parseInt(h, 16))];
  const key = xdr.LedgerKey.fromXDR(btoa(String.fromCharCode(...bytes)), "base64");
  const res = await withRetry(() => server.getLedgerEntries(key));
  return res.entries.length > 0;
}
