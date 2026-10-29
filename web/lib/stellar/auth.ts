/** Authorization entries: what the app builds for probes and what it accepts from simulation. */
import { Address, xdr } from "@stellar/stellar-sdk";
import { config } from "../config";
import { SisonkeError } from "../sisonke/errors";

/** The source-account authorization entry a call by the tx source needs (ported from scripts/e2e.ts). */
export function sourceAuth(method: string, args: xdr.ScVal[], contractId: string = config.contractId): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(contractId).toScAddress(),
          functionName: method,
          args,
        }),
      ),
      subInvocations: [],
    }),
  });
}

export const UNEXPECTED_AUTH = "Unexpected signature request. Sisonke only ever asks your wallet to sign its own transaction.";

/**
 * Every Sisonke call needs only the transaction source's signature, so every
 * auth entry from simulation must use source-account credentials. Anything
 * else would ask the wallet to sign for someone else: refuse it.
 */
export function assertSourceOnlyAuth(entries: readonly xdr.SorobanAuthorizationEntry[] | undefined): void {
  for (const entry of entries ?? []) {
    // XDR values are immutable classes in SDK 17; unions expose their variant as `.type`.
    if (entry.credentials.type !== "sorobanCredentialsSourceAccount") {
      throw new SisonkeError("Stopped before signing", UNEXPECTED_AUTH);
    }
  }
}
