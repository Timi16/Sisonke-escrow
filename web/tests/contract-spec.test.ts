/**
 * The app's hand-written encoders (lib/sisonke/contract.ts) must produce the
 * same XDR as the contract's own spec, read from the generated bindings in
 * web/contract (scripts/bindings.sh). If the contract's ABI drifts, this fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import { contract } from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { config } from "@/lib/config";
import { encode, encodeCreate } from "@/lib/sisonke/contract";
import { decodeEscrowView, decodeInfo } from "@/lib/sisonke/decode";

const client = readFileSync(fileURLToPath(new URL("../contract/src/client.ts", import.meta.url)), "utf8");
const entries = [...client.matchAll(/"(AAAA[A-Za-z0-9+/=]+)"/g)].map((m) => m[1]);
const spec = new contract.Spec(entries);

const hex = (vals: xdr.ScVal[]) => vals.map((v) => v.toXDR("base64"));
const same = (name: string, ours: xdr.ScVal[], native: object) => expect(hex(ours)).toEqual(hex(spec.funcArgsToScVals(name, native)));

const payer = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const arbiter = Keypair.random().publicKey();
const udt = (name: string) => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));

test("the bindings carry the contract spec", () => {
  expect(entries.length).toBeGreaterThan(40);
  for (const fn of ["create", "create_and_fund", "fund", "release", "refund", "reclaim", "dispute", "resolve", "cancel", "extend_escrow_ttl", "migrate", "info", "get_escrow", "get_escrows", "party_escrow_count", "party_escrow_ids"]) {
    expect(() => spec.getFunc(fn)).not.toThrow();
  }
});

describe("writes", () => {
  const terms = { payer, recipient, amount: 2_500_000_000n, deadline: 1_800_000_000n, title: "Logo for the café 😀", terms_hash: undefined };
  test.each(["create", "create_and_fund"])("%s with and without an arbiter", (name) => {
    same(name, encodeCreate({ payer, recipient, arbiter: null, amount: terms.amount, deadline: 1_800_000_000, title: terms.title }), { ...terms, arbiter: undefined });
    same(name, encodeCreate({ payer, recipient, arbiter, amount: terms.amount, deadline: 1_800_000_000, title: terms.title }), { ...terms, arbiter });
    same(name, encodeCreate({ payer, recipient, arbiter: null, amount: 1n, deadline: 2n ** 63n, title: "" }), { ...terms, arbiter: undefined, amount: 1n, deadline: 2n ** 63n, title: "" });
  });
  test.each(["fund", "release", "refund", "reclaim", "cancel", "extend_escrow_ttl", "get_escrow"])("%s(id)", (name) => {
    same(name, encode.id(42n), { id: 42n });
    same(name, encode.id(2n ** 64n - 1n), { id: 2n ** 64n - 1n });
  });
  test("dispute(id, by)", () => same("dispute", encode.dispute(7n, recipient), { id: 7n, by: recipient }));
  test("resolve(id, recipient_amount)", () => {
    same("resolve", encode.resolve(7n, 6_000_000n), { id: 7n, recipient_amount: 6_000_000n });
    same("resolve", encode.resolve(7n, 0n), { id: 7n, recipient_amount: 0n });
  });
  test("migrate()", () => same("migrate", encode.none(), {}));
});

describe("reads", () => {
  test("info()", () => same("info", encode.none(), {}));
  test("get_escrows(ids)", () => {
    same("get_escrows", encode.getEscrows([1n, 2n, 3n]), { ids: [1n, 2n, 3n] });
    same("get_escrows", encode.getEscrows([]), { ids: [] });
  });
  test.each(["Payer", "Recipient", "Arbiter"] as const)("party_escrow_count / party_escrow_ids as %s", (role) => {
    same("party_escrow_count", encode.partyCount(payer, role), { party: payer, role: { tag: role, values: undefined } });
    same("party_escrow_ids", encode.partyIds(payer, role, 3), { party: payer, role: { tag: role, values: undefined }, page: 3 });
  });
});

describe("decoding what the spec encodes", () => {
  const escrow = {
    id: 42n,
    payer,
    recipient,
    arbiter,
    token: config.usdcSacId,
    amount: 2_500_000_000n,
    deadline: 1_800_000_000n,
    title: "Logo",
    terms_hash: Buffer.alloc(32, 0xab),
    status: { tag: "Disputed", values: undefined },
    created_at: 1_790_000_000n,
    created_ledger: 5_000_000,
    funded_at: 1_790_000_100n,
    disputed_at: 1_790_000_200n,
    disputed_by: recipient,
    closed_at: 0n,
    closed_by: undefined,
    paid_to_recipient: 0n,
    paid_to_payer: 0n,
    updated_ledger: 5_000_010,
  };

  test("EscrowView", async () => {
    const { scValToNative } = await import("@stellar/stellar-sdk");
    const scv = spec.nativeToScVal({ escrow, deadline_passed: false }, udt("EscrowView"));
    const view = decodeEscrowView(scValToNative(scv));
    expect(view.deadlinePassed).toBe(false);
    expect(view.escrow).toMatchObject({
      id: 42n,
      payer,
      recipient,
      arbiter,
      amount: 2_500_000_000n,
      deadline: 1_800_000_000,
      status: "Disputed",
      termsHash: "ab".repeat(32),
      disputedBy: recipient,
      closedBy: null,
      createdLedger: 5_000_000,
      updatedLedger: 5_000_010,
    });
  });

  test("EscrowView with no arbiter and every status", async () => {
    const { scValToNative } = await import("@stellar/stellar-sdk");
    for (const tag of ["Created", "Funded", "Disputed", "Released", "Refunded", "Split", "Cancelled"]) {
      const scv = spec.nativeToScVal({ escrow: { ...escrow, arbiter: undefined, terms_hash: undefined, status: { tag, values: undefined } }, deadline_passed: true }, udt("EscrowView"));
      const v = decodeEscrowView(scValToNative(scv));
      expect(v.escrow.status).toBe(tag);
      expect(v.escrow.arbiter).toBeNull();
      expect(v.escrow.termsHash).toBeNull();
    }
  });

  test("ContractInfo, with and without a pending upgrade", async () => {
    const { scValToNative } = await import("@stellar/stellar-sdk");
    const base = {
      version: 1,
      storage_version: 1,
      admin: payer,
      pending_admin: undefined,
      token: config.usdcSacId,
      paused: false,
      upgrades_locked: false,
      escrow_count: 6n,
      total_locked: 0n,
      upgrade_delay: 3600n,
      pending_upgrade_hash: undefined,
      pending_upgrade_eta: undefined,
      pending_upgrade_expires_at: undefined,
    };
    const none = decodeInfo(scValToNative(spec.nativeToScVal(base, udt("ContractInfo"))));
    expect(none).toMatchObject({ version: 1, admin: payer, escrowCount: 6n, upgradeDelay: 3600, pendingUpgrade: null, pendingAdmin: null });
    const some = decodeInfo(
      scValToNative(
        spec.nativeToScVal(
          { ...base, pending_admin: arbiter, pending_upgrade_hash: Buffer.alloc(32, 1), pending_upgrade_eta: 2000n, pending_upgrade_expires_at: 3000n },
          udt("ContractInfo"),
        ),
      ),
    );
    expect(some.pendingUpgrade).toEqual({ hash: "01".repeat(32), eta: 2000, expiresAt: 3000 });
    expect(some.pendingAdmin).toBe(arbiter);
  });

  test("unknown statuses are refused, not guessed", async () => {
    const { scValToNative } = await import("@stellar/stellar-sdk");
    const raw = scValToNative(spec.nativeToScVal({ escrow, deadline_passed: false }, udt("EscrowView"))) as { escrow: Record<string, unknown> };
    raw.escrow.status = ["Paid"];
    expect(() => decodeEscrowView(raw)).toThrow(/Unknown status/);
  });
});
