import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { config } from "../config";
import { MESSAGES, checkAccount, checkArbiter, checkRecipient } from "./address";
import { ARBITER, PAYER, RECIPIENT } from "@/tests/fixtures";

describe("checkAccount", () => {
  test("accepts a G address, trimmed", () => {
    expect(checkAccount(`  ${PAYER}\n`)).toEqual({ ok: true, address: PAYER });
  });
  test("a secret key is cleared with a warning", () => {
    expect(checkAccount(Keypair.random().secret())).toEqual({ ok: false, error: MESSAGES.secret, clear: true });
  });
  test("muxed, contract, Sisonke itself and garbage", () => {
    const muxed = StrKey.encodeMed25519PublicKey(Buffer.concat([StrKey.decodeEd25519PublicKey(PAYER), Buffer.alloc(8, 1)]));
    expect(checkAccount(muxed)).toEqual({ ok: false, error: MESSAGES.muxed });
    expect(checkAccount(config.usdcSacId)).toEqual({ ok: false, error: MESSAGES.contract });
    expect(checkAccount(config.contractId)).toEqual({ ok: false, error: MESSAGES.sisonke });
    expect(checkAccount("GABC")).toEqual({ ok: false, error: MESSAGES.invalid });
    expect(checkAccount(PAYER.slice(0, -1) + (PAYER.endsWith("A") ? "B" : "A"))).toEqual({ ok: false, error: MESSAGES.invalid });
    expect(checkAccount(PAYER.toLowerCase())).toEqual({ ok: false, error: MESSAGES.invalid });
    expect(checkAccount("")).toEqual({ ok: false, error: MESSAGES.empty });
  });
});

describe("recipient and arbiter", () => {
  test("the recipient can't be the payer", () => {
    expect(checkRecipient(PAYER, PAYER)).toEqual({ ok: false, error: MESSAGES.self });
    expect(checkRecipient(RECIPIENT, PAYER)).toEqual({ ok: true, address: RECIPIENT });
    expect(checkRecipient(RECIPIENT, null).ok).toBe(true);
  });
  test("the arbiter can't be either party", () => {
    expect(checkArbiter(PAYER, PAYER, RECIPIENT)).toEqual({ ok: false, error: MESSAGES.arbiter });
    expect(checkArbiter(RECIPIENT, PAYER, RECIPIENT)).toEqual({ ok: false, error: MESSAGES.arbiter });
    expect(checkArbiter(ARBITER, PAYER, RECIPIENT)).toEqual({ ok: true, address: ARBITER });
    expect(checkArbiter(config.contractId, PAYER, RECIPIENT)).toEqual({ ok: false, error: MESSAGES.sisonke });
  });
});
