import type { Escrow, EscrowView } from "@/lib/sisonke/types";

export const PAYER = "GC3MZNDHHIOLPGLVSDOFFC5RYOE446OIKCXHOMMMC5OS4CUC5UNCFDJM";
export const RECIPIENT = "GAO7SJNNL3PANIKMRS5626JKO5FKTQDHS6U4Z4BHCLLBLRPYFD3WHQNM";
export const ARBITER = "GDTAEOEKBESK4RFN2EAJOS47ANJR4W36ITR6HLHUR47Q5XSCKHSQ4FZN";
export const STRANGER = "GCT3BXEOQLVHMTNWSNYQUHLUY7WOSBMNBWRINJING7U3YNVAUL7KRIFW";
export const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export function escrow(over: Partial<Escrow> = {}): Escrow {
  return {
    id: 42n,
    payer: PAYER,
    recipient: RECIPIENT,
    arbiter: null,
    token: TOKEN,
    amount: 2_500_000_000n,
    deadline: 1_800_000_000,
    title: "Logo for the café",
    termsHash: null,
    status: "Funded",
    createdAt: 1_790_000_000,
    createdLedger: 5_000_000,
    fundedAt: 1_790_000_100,
    disputedAt: 0,
    disputedBy: null,
    closedAt: 0,
    closedBy: null,
    paidToRecipient: 0n,
    paidToPayer: 0n,
    updatedLedger: 5_000_010,
    ...over,
  };
}

export const view = (over: Partial<Escrow> = {}, deadlinePassed = false): EscrowView => ({ escrow: escrow(over), deadlinePassed });
