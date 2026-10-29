import { apiError, json, parseId, preflight, upstreamError } from "@/lib/api";
import { cachedEscrow } from "@/lib/sisonke/cached";

/** GET /api/escrow/:id → { escrow, deadlinePassed }, straight from the contract. */
export async function GET(_req: Request, ctx: RouteContext<"/api/escrow/[id]">) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, "bad_id", "Escrow ids are positive integers.");
  try {
    const view = await cachedEscrow(id);
    if (!view) return apiError(404, "not_found", `Escrow #${id} doesn't exist.`);
    return json(view);
  } catch (err) {
    return upstreamError(err);
  }
}

export const OPTIONS = preflight;
