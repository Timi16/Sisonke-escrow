import { json, preflight, upstreamError } from "@/lib/api";
import { config } from "@/lib/config";
import { cachedInfo } from "@/lib/sisonke/cached";

/** GET /api/info → info() with bigints as strings, plus whether the token is Testnet USDC. */
export async function GET() {
  try {
    const info = await cachedInfo();
    return json({ contractId: config.contractId, ...info, tokenOk: info.token === config.usdcSacId }, { maxAge: 30 });
  } catch (err) {
    return upstreamError(err);
  }
}

export const OPTIONS = preflight;
