/**
 * One escrow's history from contract events (RPC getEvents), with a fallback
 * built from the stored record when the RPC no longer keeps the older steps
 * (about 7 days). Never used for amounts or status (INTEGRATION §4).
 */
import { scValToNative } from "@stellar/stellar-sdk";
import { config } from "../config";
import { server, withRetry } from "../stellar/rpc";
import { sc } from "./contract";
import type { Escrow, EscrowAction, EscrowEvent, EscrowHistory } from "./types";

const ACTIONS: EscrowAction[] = ["created", "funded", "released", "refunded", "reclaimed", "disputed", "resolved", "cancelled"];
const TOPIC = sc.symbol("sisonke").toXDR("base64");
const LIMIT = 100;

type RpcEvent = Awaited<ReturnType<typeof server.getEvents>>["events"][number];

function signer(action: EscrowAction, data: Record<string, unknown>): string | null {
  const pick = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  switch (action) {
    case "created":
    case "funded":
    case "reclaimed":
    case "cancelled":
      return pick("payer");
    case "released":
    case "refunded":
    case "disputed":
      return pick("by");
    case "resolved":
      return pick("arbiter");
  }
}

export function parseEvent(ev: RpcEvent): EscrowEvent | null {
  if (ev.topic.length < 3) return null;
  let action: string;
  try {
    action = String(scValToNative(ev.topic[1]));
  } catch {
    return null;
  }
  if (!ACTIONS.includes(action as EscrowAction)) return null;
  let data: Record<string, unknown> = {};
  try {
    const native = scValToNative(ev.value);
    if (native && typeof native === "object" && !Array.isArray(native)) data = native as Record<string, unknown>;
  } catch {
    /* keep the row; the data is only for wording */
  }
  const a = action as EscrowAction;
  return {
    id: ev.id,
    action: a,
    txHash: /^[0-9a-f]{64}$/i.test(ev.txHash) ? ev.txHash : null,
    ledger: ev.ledger,
    at: Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000),
    by: signer(a, data),
    data,
  };
}

/** Steps the stored record says happened, for the retention fallback. */
export function expectedSteps(e: Escrow): { action: EscrowAction; at: number; by: string | null }[] {
  const steps: { action: EscrowAction; at: number; by: string | null }[] = [{ action: "created", at: e.createdAt, by: e.payer }];
  if (e.fundedAt > 0) steps.push({ action: "funded", at: e.fundedAt, by: e.payer });
  if (e.disputedAt > 0) steps.push({ action: "disputed", at: e.disputedAt, by: e.disputedBy });
  if (e.closedAt > 0) {
    const closer = e.closedBy;
    let action: EscrowAction;
    if (e.status === "Cancelled") action = "cancelled";
    else if (closer && e.arbiter && closer === e.arbiter) action = "resolved";
    else if (e.status === "Released") action = "released";
    else if (e.status === "Split") action = "resolved";
    else action = closer === e.payer ? "reclaimed" : "refunded";
    steps.push({ action, at: e.closedAt, by: closer });
  }
  return steps;
}

/** Fills in steps the RPC no longer has, from the stored timestamps. */
export function withFallback(e: Escrow, events: EscrowEvent[], truncated: boolean): EscrowHistory {
  const have = new Set(events.map((ev) => ev.action));
  const missing = expectedSteps(e).filter((s) => !have.has(s.action));
  const rebuilt: EscrowEvent[] = missing.map((s) => ({
    id: `stored:${s.action}`,
    action: s.action,
    txHash: null,
    ledger: null,
    at: s.at,
    by: s.by,
    data:
      s.action === "resolved"
        ? { recipient_amount: e.paidToRecipient, payer_amount: e.paidToPayer }
        : s.action === "funded"
          ? { amount: e.amount }
          : {},
  }));
  const all = [...events, ...rebuilt].sort((a, b) => a.at - b.at || (a.ledger ?? 0) - (b.ledger ?? 0));
  return { events: all, truncated: truncated || rebuilt.length > 0 };
}

/** Every event for one escrow, oldest first. */
export async function getEscrowHistory(e: Escrow): Promise<EscrowHistory> {
  const health = await withRetry(() => server.getHealth());
  const truncated = e.createdLedger < health.oldestLedger;
  const startLedger = Math.max(e.createdLedger, health.oldestLedger);
  const filters = [
    { type: "contract" as const, contractIds: [config.contractId], topics: [[TOPIC, "*", sc.u64(e.id).toXDR("base64")]] },
  ];
  const out: EscrowEvent[] = [];
  let page = await withRetry(() => server.getEvents({ filters, startLedger, limit: LIMIT }));
  for (let guard = 0; guard < 20; guard++) {
    for (const ev of page.events) {
      const parsed = parseEvent(ev);
      if (parsed) out.push(parsed);
    }
    if (page.events.length < LIMIT) break;
    const cursor = page.cursor;
    page = await withRetry(() => server.getEvents({ filters, cursor, limit: LIMIT }));
  }
  return withFallback(e, out, truncated);
}
