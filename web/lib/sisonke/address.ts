/** Stellar account validation with plain-words messages (WEB_PLAN §8.3). */
import { StrKey } from "@stellar/stellar-sdk";
import { config } from "../config";

export type AddressCheck =
  | { ok: true; address: string }
  | { ok: false; error: string; /** The field must be cleared (a secret key was pasted). */ clear?: boolean };

export const MESSAGES = {
  invalid: "That doesn't look like a Stellar address. It starts with G and is 56 characters long.",
  secret: "That's a secret key. Never paste it anywhere. Sisonke only needs an address that starts with G.",
  muxed: "Use the plain G… address, not a muxed M… one.",
  contract: "Use a wallet address (G…), not a contract.",
  self: "That's your own address. You can't pay yourself.",
  arbiter: "The arbiter must be someone other than you and the recipient.",
  sisonke: "The payer, recipient and arbiter must be wallets, not the Sisonke contract itself.",
  empty: "Enter their Stellar address.",
} as const;

export const isAccount = (address: string) => StrKey.isValidEd25519PublicKey(address);

/** Any one account field. */
export function checkAccount(raw: string): AddressCheck {
  const a = raw.trim();
  if (!a) return { ok: false, error: MESSAGES.empty };
  if (StrKey.isValidEd25519SecretSeed(a)) return { ok: false, error: MESSAGES.secret, clear: true };
  if (a === config.contractId) return { ok: false, error: MESSAGES.sisonke };
  if (StrKey.isValidMed25519PublicKey(a)) return { ok: false, error: MESSAGES.muxed };
  if (StrKey.isValidContract(a)) return { ok: false, error: MESSAGES.contract };
  if (!StrKey.isValidEd25519PublicKey(a)) return { ok: false, error: MESSAGES.invalid };
  return { ok: true, address: a };
}

/** The recipient field on /new: also refuses the payer's own address. */
export function checkRecipient(raw: string, payer: string | null): AddressCheck {
  const r = checkAccount(raw);
  if (r.ok && payer && r.address === payer) return { ok: false, error: MESSAGES.self };
  return r;
}

/** The arbiter field on /new: someone other than the payer and the recipient. */
export function checkArbiter(raw: string, payer: string | null, recipient: string | null): AddressCheck {
  const r = checkAccount(raw);
  if (r.ok && (r.address === payer || r.address === recipient)) return { ok: false, error: MESSAGES.arbiter };
  return r;
}
