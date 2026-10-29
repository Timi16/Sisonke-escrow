import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const DIRS = ["app", "components", "lib"];
const BANNED: [string, RegExp][] = [
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["innerHTML", /\.innerHTML\b/],
  ["outerHTML", /\.outerHTML\b/],
  ["insertAdjacentHTML", /insertAdjacentHTML/],
  ["document.write", /document\.write/],
  ["eval(", /(^|[^\w.])eval\s*\(/],
  ["new Function", /new\s+Function\s*\(/],
  ["string setTimeout", /setTimeout\(\s*["'`]/],
  ["string setInterval", /setInterval\(\s*["'`]/],
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sources = DIRS.flatMap((d) => files(path.join(WEB, d)));

test("there are sources to scan", () => {
  expect(sources.length).toBeGreaterThan(20);
});

test.each(BANNED)("no %s in app/, components/ or lib/", (_name, pattern) => {
  const hits = sources.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f));
  expect(hits).toEqual([]);
});
