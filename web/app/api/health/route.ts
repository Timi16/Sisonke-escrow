import { connection } from "next/server";
import { json, preflight } from "@/lib/api";
import { config } from "@/lib/config";
import { server } from "@/lib/stellar/rpc";

/** GET /api/health → RPC and Horizon reachability. Never cached. */
export async function GET() {
  await connection();
  const [rpcHealth, horizon] = await Promise.allSettled([
    server.getHealth(),
    fetch(config.horizonUrl, { cache: "no-store" }).then((r) => r.ok),
  ]);
  const rpcOk = rpcHealth.status === "fulfilled" && rpcHealth.value.status === "healthy";
  const horizonOk = horizon.status === "fulfilled" && horizon.value;
  return json(
    {
      ok: rpcOk && horizonOk,
      rpc: rpcHealth.status === "fulfilled" ? { status: rpcHealth.value.status, latestLedger: rpcHealth.value.latestLedger, oldestLedger: rpcHealth.value.oldestLedger } : { status: "unreachable" },
      horizon: { ok: horizonOk },
      network: config.network,
      contractId: config.contractId,
    },
    { status: rpcOk && horizonOk ? 200 : 503, maxAge: 0 },
  );
}

export const OPTIONS = preflight;
