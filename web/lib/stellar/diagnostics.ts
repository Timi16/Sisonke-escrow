import { scValToNative, type rpc, type xdr } from "@stellar/stellar-sdk";

/**
 * The error a failed invocation recorded on-chain, read from its
 * `host_fn_failed` diagnostic event, worded like simulation errors
 * ("Error(Contract, #2)") so one mapper handles both.
 */
export function chainError(events: xdr.DiagnosticEvent[] | undefined): string | undefined {
  for (const event of events ?? []) {
    // XDR values are immutable classes in SDK 17; unions expose .value.
    const body = (event as unknown as { event?: { body?: { value?: { topics?: xdr.ScVal[] }; topics?: xdr.ScVal[] } } })
      .event?.body;
    const topics = (body?.value ?? body)?.topics ?? [];
    if (topics.length < 2) continue;
    try {
      if (scValToNative(topics[0]) !== "host_fn_failed") continue;
    } catch {
      continue;
    }
    const raw = topics[1] as unknown as { value?: { toXdrObject?: () => unknown }; toXdrObject?: () => unknown };
    const err = ((raw.value ?? raw).toXdrObject?.() ?? {}) as { contractCode?: number; type?: number; code?: number };
    if (err.contractCode !== undefined) return `Error(Contract, #${err.contractCode})`;
    if (err.type === 9) return "Error(Auth, InvalidAction)";
    return `Error(type ${err.type}, code ${err.code})`;
  }
  return undefined;
}

export type FailedTx = rpc.Api.GetFailedTransactionResponse;
