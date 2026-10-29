/**
 * Startup checks (WEB_PLAN §4.8, INTEGRATION §1). Any failure means the app
 * shows no escrow data at all: it may be pointed at the wrong contract,
 * network or token.
 */
import { Asset, StrKey } from "@stellar/stellar-sdk";
import { config } from "../config";
import type { ContractInfo } from "../sisonke/types";

export interface Misconfigured {
  reason: string;
}

/** Checks that need no network. */
export function staticChecks(): Misconfigured | null {
  if (!StrKey.isValidContract(config.contractId)) return { reason: "The Sisonke contract id in this build isn't a valid contract id." };
  if (!StrKey.isValidContract(config.usdcSacId)) return { reason: "The USDC token id in this build isn't a valid contract id." };
  if (!StrKey.isValidEd25519PublicKey(config.usdcIssuer)) return { reason: "The USDC issuer in this build isn't a valid account." };
  if (new Asset("USDC", config.usdcIssuer).contractId(config.networkPassphrase) !== config.usdcSacId) {
    return { reason: "The USDC token id doesn't match Circle's Testnet USDC for this network." };
  }
  return null;
}

/** Checks against the live RPC and the contract's own info(). */
export function liveChecks(passphrase: string, info: ContractInfo): Misconfigured | null {
  if (passphrase !== config.networkPassphrase) {
    return { reason: "The Stellar RPC this app uses is on a different network than the app expects." };
  }
  if (info.token !== config.usdcSacId) {
    return { reason: "This app is pointed at a contract that doesn't use Testnet USDC, so Sisonke won't show it." };
  }
  return null;
}
