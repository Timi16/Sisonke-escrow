/**
 * Server-side cached reads, for the API routes only. Pages read the chain
 * from the browser and never depend on these.
 */
import { cacheLife, cacheTag } from "next/cache";
import { getEscrow, getInfo } from "./reads";

export async function cachedInfo() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  return getInfo();
}

export async function cachedEscrow(id: string) {
  "use cache";
  cacheLife({ stale: 10, revalidate: 10, expire: 60 });
  cacheTag(`escrow-${id}`);
  return getEscrow(BigInt(id));
}
