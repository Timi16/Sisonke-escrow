import { apiError, isAccount } from "@/lib/api";
import { config } from "@/lib/config";

/**
 * POST /api/friendbot { address } → funds a Testnet account with XLM.
 * Testnet only, same-origin only (it's for /setup, not a public proxy), with a
 * small per-IP and per-address limit so abuse can't burn Friendbot's limit for
 * real users. Calls only config.friendbotUrl with the validated address. Holds no keys.
 */

const WINDOW_MS = 60_000;
const PER_IP = 10;
const hits = new Map<string, number[]>();

/** Best-effort, per server instance. True if `key` is over `limit` in the window. */
function limited(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > limit;
}

const noStore = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host || new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (config.network !== "testnet") return apiError(400, "not_testnet", "Friendbot only exists on Testnet.");
  if (!sameOrigin(req)) return apiError(403, "forbidden", "Use the Sisonke setup page to get test XLM.");
  const body = (await req.json().catch(() => null)) as { address?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!isAccount(address)) return apiError(400, "bad_address", "Expected a Stellar account (G…).");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(`ip:${ip}`, PER_IP) || limited(`addr:${address}`, 2)) {
    return apiError(429, "slow_down", "Too many requests. Wait a minute and try again.");
  }

  let res: Response;
  try {
    res = await fetch(`${config.friendbotUrl}?addr=${encodeURIComponent(address)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return apiError(504, "friendbot_timeout", "Friendbot didn't answer in time. Try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { hash?: unknown; detail?: unknown };
  const hash = typeof data.hash === "string" && /^[0-9a-f]{64}$/i.test(data.hash) ? data.hash : null;
  if (res.ok) return noStore({ funded: true, hash });
  // Friendbot answers 400 when the account already exists: that's ready, not a failure.
  if (/already|createAccountAlreadyExist/i.test(JSON.stringify(data))) {
    return noStore({ funded: true, alreadyFunded: true, hash: null });
  }
  return apiError(502, "friendbot_failed", `Friendbot responded ${res.status}`);
}
