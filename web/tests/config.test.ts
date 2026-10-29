import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Asset, Keypair } from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { config, explorer } from "@/lib/config";
import { deployment } from "@/lib/generated/deployment";
import proof from "@/lib/generated/proof.json";
import { KEYS, parseEnv } from "../scripts/sync-deployment.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("generated deployment data", () => {
  test("matches deployments/testnet.env (run pnpm sync if this fails)", () => {
    const env = parseEnv(read("../../deployments/testnet.env")) as Record<string, string>;
    const expected = Object.fromEntries((KEYS as string[]).map((k) => [k, env[k]]));
    expect({ ...deployment }).toEqual(expected);
  });
  test("proof.json matches deployments/testnet-e2e.json", () => {
    expect(proof).toEqual(JSON.parse(read("../../deployments/testnet-e2e.json")));
  });
  test("config defaults come from it", () => {
    expect(config.contractId).toBe(deployment.NEXT_PUBLIC_SISONKE_CONTRACT_ID);
    expect(config.networkPassphrase).toBe(deployment.NEXT_PUBLIC_NETWORK_PASSPHRASE);
  });
  test("the USDC SAC id is Circle's Testnet USDC on this network", () => {
    expect(new Asset("USDC", config.usdcIssuer).contractId(config.networkPassphrase)).toBe(config.usdcSacId);
  });
  test("parseEnv drops comments and quotes", () => {
    expect(parseEnv('# c\nA=1\nB="x ; y"\n\nC=')).toEqual({ A: "1", B: "x ; y", C: "" });
  });
});

describe("explorer links validate their input", () => {
  test("tx", () => {
    const hash = "ab".repeat(32);
    expect(explorer.tx(hash)).toBe(`${config.explorerUrl}/tx/${hash}`);
    expect(explorer.tx(hash.toUpperCase())).toBe(`${config.explorerUrl}/tx/${hash}`);
    expect(() => explorer.tx("abc")).toThrow();
    expect(() => explorer.tx(`${hash}/../x`)).toThrow();
    expect(() => explorer.tx("javascript:alert(1)")).toThrow();
  });
  test("account", () => {
    const g = Keypair.random().publicKey();
    expect(explorer.account(g)).toBe(`${config.explorerUrl}/account/${g}`);
    expect(() => explorer.account(config.contractId)).toThrow();
    expect(() => explorer.account("G123")).toThrow();
  });
  test("contract", () => {
    expect(explorer.contract()).toBe(`${config.explorerUrl}/contract/${config.contractId}`);
    expect(() => explorer.contract(Keypair.random().publicKey())).toThrow();
  });
});
