import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative, type xdr } from "@stellar/stellar-sdk";
import { config } from "../config";
import type { ReadMethod } from "../sisonke/contract";

export const server = new rpc.Server(config.rpcUrl);
export const sisonke = new Contract(config.contractId);

/** Any well-formed address works as the source of a read-only simulation. */
export const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** A contract refused a read; carries the raw "Error(Contract, #N)" text. */
export class SimulationError extends Error {}

/** Public RPC occasionally returns 502/503; retry those, never contract errors. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const transient = err instanceof SimulationError ? false : status === undefined || status >= 500;
      if (!transient || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
}

function readTx(contract: Contract, method: string, args: xdr.ScVal[]) {
  return new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
}

/** Calls a contract function through simulation: no signature, no fee. */
export async function view(method: ReadMethod, args: xdr.ScVal[] = []): Promise<unknown> {
  return viewOn(sisonke, method, args);
}

/** Same, on any contract (the USDC SAC's `balance`). */
export async function viewOn(contract: Contract, method: string, args: xdr.ScVal[] = []): Promise<unknown> {
  const sim = await withRetry(() => server.simulateTransaction(readTx(contract, method, args)));
  if (rpc.Api.isSimulationError(sim)) throw new SimulationError(sim.error);
  if (!sim.result) throw new SimulationError(`${method} returned no result`);
  return scValToNative(sim.result.retval);
}
