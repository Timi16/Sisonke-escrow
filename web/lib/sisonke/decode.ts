/** scValToNative output (snake_case) → typed objects. Throws on anything unexpected. */
import { STATUSES, type ContractInfo, type Escrow, type EscrowView, type Status } from "./types";

type Raw = Record<string, unknown>;

export class DecodeError extends Error {}

function variant(v: unknown): string {
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  if (typeof v === "string") return v;
  throw new DecodeError("Unexpected enum value");
}

export function decodeStatus(v: unknown): Status {
  const s = variant(v);
  if (!(STATUSES as readonly string[]).includes(s)) throw new DecodeError(`Unknown status "${s.slice(0, 20)}"`);
  return s as Status;
}

function big(v: unknown, field: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  throw new DecodeError(`${field} is not an integer`);
}

/** Timestamps and ledgers: integers that fit a JS number exactly. */
function num(v: unknown, field: string): number {
  const b = big(v, field);
  if (b < 0n || b > BigInt(Number.MAX_SAFE_INTEGER)) throw new DecodeError(`${field} out of range`);
  return Number(b);
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string") throw new DecodeError(`${field} is not a string`);
  return v;
}

const opt = <T>(v: unknown, f: (x: unknown) => T): T | null => (v === null || v === undefined ? null : f(v));

function hex(v: unknown, field: string): string {
  if (v instanceof Uint8Array) return Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
  throw new DecodeError(`${field} is not bytes`);
}

export function decodeEscrow(raw: unknown): Escrow {
  const e = raw as Raw;
  if (!e || typeof e !== "object") throw new DecodeError("Escrow is not a map");
  return {
    id: big(e.id, "id"),
    payer: str(e.payer, "payer"),
    recipient: str(e.recipient, "recipient"),
    arbiter: opt(e.arbiter, (x) => str(x, "arbiter")),
    token: str(e.token, "token"),
    amount: big(e.amount, "amount"),
    deadline: num(e.deadline, "deadline"),
    title: typeof e.title === "string" ? e.title : "",
    termsHash: opt(e.terms_hash, (x) => hex(x, "terms_hash")),
    status: decodeStatus(e.status),
    createdAt: num(e.created_at, "created_at"),
    createdLedger: num(e.created_ledger, "created_ledger"),
    fundedAt: num(e.funded_at, "funded_at"),
    disputedAt: num(e.disputed_at, "disputed_at"),
    disputedBy: opt(e.disputed_by, (x) => str(x, "disputed_by")),
    closedAt: num(e.closed_at, "closed_at"),
    closedBy: opt(e.closed_by, (x) => str(x, "closed_by")),
    paidToRecipient: big(e.paid_to_recipient, "paid_to_recipient"),
    paidToPayer: big(e.paid_to_payer, "paid_to_payer"),
    updatedLedger: num(e.updated_ledger, "updated_ledger"),
  };
}

export function decodeEscrowView(raw: unknown): EscrowView {
  const v = raw as Raw;
  if (!v || typeof v !== "object" || typeof v.deadline_passed !== "boolean") {
    throw new DecodeError("EscrowView is malformed");
  }
  return { escrow: decodeEscrow(v.escrow), deadlinePassed: v.deadline_passed };
}

export function decodeInfo(raw: unknown): ContractInfo {
  const i = raw as Raw;
  if (!i || typeof i !== "object") throw new DecodeError("ContractInfo is not a map");
  const hash = opt(i.pending_upgrade_hash, (x) => hex(x, "pending_upgrade_hash"));
  const eta = opt(i.pending_upgrade_eta, (x) => num(x, "pending_upgrade_eta"));
  const expiresAt = opt(i.pending_upgrade_expires_at, (x) => num(x, "pending_upgrade_expires_at"));
  return {
    version: num(i.version, "version"),
    storageVersion: num(i.storage_version, "storage_version"),
    admin: str(i.admin, "admin"),
    pendingAdmin: opt(i.pending_admin, (x) => str(x, "pending_admin")),
    token: str(i.token, "token"),
    paused: i.paused === true,
    upgradesLocked: i.upgrades_locked === true,
    escrowCount: big(i.escrow_count, "escrow_count"),
    totalLocked: big(i.total_locked, "total_locked"),
    upgradeDelay: num(i.upgrade_delay, "upgrade_delay"),
    pendingUpgrade: hash && eta !== null && expiresAt !== null ? { hash, eta, expiresAt } : null,
  };
}
