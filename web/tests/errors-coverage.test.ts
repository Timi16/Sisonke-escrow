import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CONTRACT_ERRORS } from "@/lib/sisonke/errors";

const source = readFileSync(fileURLToPath(new URL("../../contracts/sisonke-escrow/src/errors.rs", import.meta.url)), "utf8");
const fromRust = Object.fromEntries([...source.matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)].map((m) => [Number(m[2]), m[1]]));

test("errors.rs has codes to compare against", () => {
  expect(Object.keys(fromRust).length).toBeGreaterThanOrEqual(29);
});

test("errors.ts has exactly errors.rs's code → name set", () => {
  const fromTs = Object.fromEntries(Object.entries(CONTRACT_ERRORS).map(([code, e]) => [Number(code), e.name]));
  expect(fromTs).toEqual(fromRust);
});

test("every code has a title and a body", () => {
  for (const [code, e] of Object.entries(CONTRACT_ERRORS)) {
    expect(e.title.trim(), `title for ${code}`).not.toBe("");
    expect(e.body({}).trim(), `body for ${code}`).not.toBe("");
  }
});
