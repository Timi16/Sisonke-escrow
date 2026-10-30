import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { config } from "../config";
import { encode } from "../sisonke/contract";
import { SisonkeError } from "../sisonke/errors";
import { UNEXPECTED_AUTH, assertSourceOnlyAuth, sourceAuth } from "./auth";
import { precheck, verifySigned } from "./tx";

const key = Keypair.random();

function buildTx(passphrase = config.networkPassphrase, fee = "100") {
  return new TransactionBuilder(new Account(key.publicKey(), "41"), { fee, networkPassphrase: passphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: "100" }))
    .setTimeout(0)
    .build();
}

describe("assertSourceOnlyAuth", () => {
  const args = encode.id(42n);
  test("accepts source-account credentials and an empty list", () => {
    expect(() => assertSourceOnlyAuth([sourceAuth("release", args)])).not.toThrow();
    expect(() => assertSourceOnlyAuth([])).not.toThrow();
    expect(() => assertSourceOnlyAuth(undefined)).not.toThrow();
  });
  test("rejects address credentials (a signature for someone else)", () => {
    const root = sourceAuth("release", args).rootInvocation;
    const other = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: Address.fromString(Keypair.random().publicKey()).toScAddress(),
          nonce: 1n,
          signatureExpirationLedger: 100,
          signature: nativeToScVal(null),
        }),
      ),
      rootInvocation: root,
    });
    expect(() => assertSourceOnlyAuth([sourceAuth("release", args), other])).toThrow(SisonkeError);
    try {
      assertSourceOnlyAuth([other]);
    } catch (e) {
      expect((e as SisonkeError).body).toBe(UNEXPECTED_AUTH);
    }
  });
  test("sourceAuth targets the Sisonke contract and method", () => {
    const entry = sourceAuth("fund", args);
    expect(entry.credentials.type).toBe("sorobanCredentialsSourceAccount");
    const xdrB64 = entry.toXDR("base64");
    expect(xdr.SorobanAuthorizationEntry.fromXDR(xdrB64, "base64").toXDR("base64")).toBe(xdrB64);
  });
});

describe("verifySigned", () => {
  test("accepts the same transaction signed by the source for this network", () => {
    const prepared = buildTx();
    const signed = TransactionBuilder.fromXDR(prepared.toXDR(), config.networkPassphrase) as ReturnType<typeof buildTx>;
    signed.sign(key);
    expect(verifySigned(prepared, signed.toXDR(), key.publicKey()).hash()).toEqual(prepared.hash());
  });

  test("rejects a signature made for another network", () => {
    const prepared = buildTx();
    const elsewhere = buildTx(Networks.PUBLIC);
    elsewhere.sign(key);
    const envelope = TransactionBuilder.fromXDR(prepared.toXDR(), config.networkPassphrase) as ReturnType<typeof buildTx>;
    envelope.addDecoratedSignature(elsewhere.signatures[0]);
    expect(() => verifySigned(prepared, envelope.toXDR(), key.publicKey())).toThrow(/different network/);
  });

  test("rejects a signature by someone else", () => {
    const prepared = buildTx();
    const signed = TransactionBuilder.fromXDR(prepared.toXDR(), config.networkPassphrase) as ReturnType<typeof buildTx>;
    signed.sign(Keypair.random());
    expect(() => verifySigned(prepared, signed.toXDR(), key.publicKey())).toThrow(SisonkeError);
  });

  test("rejects an unsigned envelope", () => {
    const prepared = buildTx();
    expect(() => verifySigned(prepared, prepared.toXDR(), key.publicKey())).toThrow(/different network/);
  });

  test("rejects a transaction the wallet changed", () => {
    const prepared = buildTx();
    const changed = buildTx(config.networkPassphrase, "5000");
    changed.sign(key);
    expect(() => verifySigned(prepared, changed.toXDR(), key.publicKey())).toThrow(/different transaction/);
  });

  test("rejects garbage", () => {
    expect(() => verifySigned(buildTx(), "not xdr", key.publicKey())).toThrow(/couldn't read/);
  });
});

describe("precheck", () => {
  const base = { method: "fund" as const, connected: true, onTestnet: true, formatAmount: (s: bigint) => (Number(s) / 1e7).toFixed(2) };
  const ready = { exists: true, usdc: { balance: "120.0000000", authorized: true } };
  test("connection, network and XLM", () => {
    expect(precheck({ ...base, connected: false })?.title).toBe("Connect a wallet");
    expect(precheck({ ...base, onTestnet: false })?.title).toBe("Wrong network");
    expect(precheck({ ...base, readiness: { exists: false, usdc: null } })?.body).toBe("This wallet has no XLM yet. Get test XLM in Test funds.");
  });
  test("deposits need a trustline and enough USDC", () => {
    expect(precheck({ ...base, readiness: { exists: true, usdc: null }, amount: 1n })?.title).toBe("Your wallet can't hold USDC yet");
    expect(precheck({ ...base, readiness: { exists: true, usdc: { balance: "5", authorized: false } }, amount: 1n })?.title).toMatch(/frozen/);
    const low = precheck({ ...base, readiness: ready, amount: 2_500_000_000n, usdcBalance: 1_200_000_000n });
    expect(low?.body).toBe("This deposit needs 250.00 USDC and your wallet has 120.00. Top up, then try again. Nothing was sent.");
    expect(low?.fix).toEqual({ label: "Get test USDC", href: "/setup" });
    expect(precheck({ ...base, readiness: ready, amount: 1_200_000_000n, usdcBalance: 1_200_000_000n })).toBeNull();
  });
  test("other methods don't check USDC", () => {
    expect(precheck({ ...base, method: "release", readiness: { exists: true, usdc: null } })).toBeNull();
    expect(precheck({ ...base, method: "create", readiness: { exists: true, usdc: null } })).toBeNull();
  });
});
