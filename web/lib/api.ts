import { StrKey } from "@stellar/stellar-sdk";
import { toSisonkeError } from "./sisonke/errors";

/** Public, read-only JSON API: CORS-open and CDN-cacheable for a few seconds. */
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Bigints become decimal strings. */
export const serialise = (data: unknown) =>
  JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as unknown;

export function json(data: unknown, { status = 200, maxAge = 10 }: { status?: number; maxAge?: number } = {}) {
  return Response.json(serialise(data), {
    status,
    headers: {
      ...HEADERS,
      "Cache-Control": maxAge > 0 ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 3}` : "no-store",
    },
  });
}

export function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status, maxAge: 0 });
}

/** The chain or the RPC failed: a 502 with plain words. */
export function upstreamError(err: unknown) {
  const e = toSisonkeError(err);
  return apiError(502, "upstream", `${e.title}: ${e.body}`);
}

export function preflight() {
  return new Response(null, { status: 204, headers: HEADERS });
}

/** Escrow ids are positive integers of at most 15 digits. */
export function parseId(raw: string): string | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const id = BigInt(raw);
  return id >= 1n ? id.toString() : null;
}

/** Find box input: 42, #42, #0042, or any text containing /escrow/<digits>. */
export function parseEscrowQuery(raw: string): string | null {
  const t = raw.trim();
  const link = /\/escrow\/(\d{1,15})(?:[/?#]|$)/.exec(t);
  if (link) return parseId(link[1]);
  const m = /^#?(\d{1,15})$/.exec(t);
  return m ? parseId(m[1]) : null;
}

export const isAccount = (address: string) => StrKey.isValidEd25519PublicKey(address);
