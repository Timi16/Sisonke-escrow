/**
 * Screenshots of every page, at desktop 1440×1000 and phone 390×844 (DPR 2).
 *
 *   pnpm dev            # or pnpm build && pnpm start
 *   pnpm screens        # BASE_URL=http://localhost:3000 by default
 *
 * Writes full-page PNGs to e2e/shots/<desktop|phone>/<nn>-<name>.png (the
 * folders are emptied first, so the numbering always matches this run), and with
 * E2E_VIDEO=1 a video per browser context to e2e/videos/.
 *
 * Needs no e2e run first. Final states come from the live escrows the
 * contract already holds (1 Split, 2 reclaimed, 3 Released, 4 refunded by the
 * recipient, 5 Released, 6 Cancelled). Open states (Awaiting deposit, Funded,
 * In dispute) come from small fixtures created once in Node and cached in
 * e2e/.out/fixtures.json (addresses and ids only, never keys). Each role's view
 * is the stand-in wallet "connected" as that escrow's payer, recipient or
 * arbiter: viewing needs no signature. Signing-stage shots use a wallet that
 * never answers, so nothing is ever sent from this script's browser.
 *
 * Every shot waits for network idle and fonts, and fails the run on any
 * console error (CSP violations included) or horizontal scroll.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { chromium } from "playwright-core";
import {
  BASE,
  OUT,
  WEB,
  addTrustline,
  createArgs,
  escrowViaApi,
  friendbot,
  funder,
  infoViaApi,
  invoke,
  ledgerTime,
  readJson,
  sc,
  usdcOf,
} from "./lib/chain.mjs";
import { CHROME, walletContext } from "./lib/freighter-stand-in.mjs";

const SHOTS = path.join(WEB, "e2e/shots");
const VIDEO = process.env.E2E_VIDEO === "1" ? path.join(WEB, "e2e/videos") : undefined;
const FIXTURES = path.join(OUT, "fixtures.json");
const FIXTURE_AMOUNT = 1_000_000n; // 0.1 USDC
const WEEK = 7 * 86_400;

const issues = { step: "", console: [], requests: [] };
const failures = [];
const written = [];

// ------------------------------------------------------------------ data

async function liveEscrow(id) {
  const view = await escrowViaApi(id);
  if (!view) throw new Error(`Escrow #${id} doesn't exist on this contract; screens expect the scripts/e2e.ts escrows 1–6.`);
  return { id: String(id), ...view.escrow, deadlinePassed: view.deadlinePassed };
}

async function stillValid(id, status) {
  if (!id) return false;
  const v = await escrowViaApi(id).catch(() => null);
  return !!v && v.escrow.status === status && !v.deadlinePassed;
}

/** Awaiting deposit, Funded and In dispute escrows, created once and reused. */
async function fixtures() {
  const cached = readJson(FIXTURES, {});
  const out = { ...cached };
  const now = await ledgerTime();
  const fund = funder();

  if (!(await stillValid(out.created?.id, "Created"))) {
    console.log("  creating the Awaiting deposit fixture…");
    const payer = Keypair.random();
    await friendbot(payer.publicKey());
    const recipient = Keypair.random();
    await friendbot(recipient.publicKey());
    await addTrustline(recipient);
    const res = await invoke(payer, "create", createArgs({ payer: payer.publicKey(), recipient: recipient.publicKey(), amount: FIXTURE_AMOUNT, deadline: now + WEEK, title: "Logo for the café" }));
    out.created = { id: String(res.value) };
  }

  const usdc = fund ? ((await usdcOf(fund.publicKey())) ?? 0n) : 0n;
  const canFund = fund && usdc >= FIXTURE_AMOUNT * 2n;
  if (!canFund) console.log("  ! no funder with ≥ 0.2 USDC (scripts/.env E2E_PAYER_SECRET): skipping Funded and In dispute fixtures");

  if (canFund && !(await stillValid(out.funded?.id, "Funded"))) {
    console.log("  creating the Funded fixture…");
    const recipient = Keypair.random();
    await friendbot(recipient.publicKey());
    await addTrustline(recipient);
    const arbiter = Keypair.random().publicKey();
    const res = await invoke(fund, "create_and_fund", createArgs({ payer: fund.publicKey(), recipient: recipient.publicKey(), arbiter, amount: FIXTURE_AMOUNT, deadline: now + WEEK, title: "Website copy, first draft" }));
    out.funded = { id: String(res.value) };
  }

  if (canFund && !(await stillValid(out.disputed?.id, "Disputed"))) {
    console.log("  creating the In dispute fixture…");
    const recipient = Keypair.random();
    await friendbot(recipient.publicKey());
    await addTrustline(recipient);
    const arbiter = Keypair.random().publicKey();
    const res = await invoke(fund, "create_and_fund", createArgs({ payer: fund.publicKey(), recipient: recipient.publicKey(), arbiter, amount: FIXTURE_AMOUNT, deadline: now + WEEK, title: "Product photos" }));
    const id = String(res.value);
    await invoke(recipient, "dispute", [sc.u64(id), sc.address(recipient.publicKey())]);
    out.disputed = { id };
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(FIXTURES, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

// ------------------------------------------------------------------ shooting

let counter = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function settle(page, ready) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  if (ready) await ready(page);
  await page.evaluate(() => document.fonts.ready);
  // next/image lazy-loads below the fold: scroll through once so full-page shots have every photo.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // Let entrance animations (≤ .8s + stagger) finish.
  await page.waitForTimeout(1200);
}

/**
 * One named shot at both sizes.
 * opts: { path, address, keypair, hold, ready(page), act(page, mobile), skipPhone }
 */
async function shot(browser, name, opts) {
  const nn = String(++counter).padStart(2, "0");
  for (const mobile of [false, true]) {
    if (mobile && opts.skipPhone) continue;
    const label = `${nn}-${slug(name)} (${mobile ? "phone" : "desktop"})`;
    issues.step = label;
    const before = issues.console.length;
    const { ctx, page } = await walletContext(browser, {
      address: opts.address,
      keypair: opts.keypair ?? null,
      connected: !!opts.address,
      hold: opts.hold ?? false,
      mobile,
      video: VIDEO,
      base: BASE,
      issues,
    });
    try {
      await page.goto(`${BASE}${opts.path}`, { waitUntil: "domcontentloaded" });
      await settle(page, opts.ready);
      if (opts.act) {
        await opts.act(page, mobile);
        await settle(page);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) failures.push(`${label}: horizontal scroll (${overflow}px wider than the viewport)`);
      const dir = path.join(SHOTS, mobile ? "phone" : "desktop");
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${nn}-${slug(name)}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      written.push(path.relative(WEB, file));
      const errs = issues.console.slice(before);
      if (errs.length) failures.push(`${label}: console errors: ${errs.map((e) => e.text).join(" | ")}`);
      console.log(`  ${errs.length || overflow > 0 ? "✖" : "✓"} ${label}`);
    } catch (err) {
      failures.push(`${label}: ${err.message.split("\n")[0]}`);
      console.log(`  ✖ ${label}\n      ${err.message.split("\n")[0]}`);
    } finally {
      await ctx.close();
    }
  }
}

const h1 = (page) => page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
const escrowReady = (page) => page.getByRole("heading", { level: 1, name: /Escrow #/i }).waitFor({ timeout: 30_000 });
const text = (t) => (page) => page.getByText(t).first().waitFor({ timeout: 30_000 });
/** Overview and Escrows: the wallet's three party reads have landed. */
const listReady = async (page) => {
  await h1(page);
  await page.getByText("Loading your escrows from Stellar…").waitFor({ state: "detached", timeout: 45_000 });
};

// ------------------------------------------------------------------ run

async function main() {
  console.log(`Sisonke screenshots against ${BASE}`);
  const info = await infoViaApi();
  const live = {};
  for (const id of [1, 2, 3, 4, 6]) live[id] = await liveEscrow(id);
  const fx = await fixtures();
  const open = {};
  for (const key of ["created", "funded", "disputed"]) if (fx[key]) open[key] = await liveEscrow(fx[key].id);
  const fund = funder();
  const stranger = Keypair.random();
  // The stranger needs an account for "Try anyway" (simulation loads the source account).
  await friendbot(stranger.publicKey());

  rmSync(SHOTS, { recursive: true, force: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    await shot(browser, "landing", { path: "/", ready: h1 });
    await shot(browser, "rules", { path: "/rules", ready: h1 });
    await shot(browser, "test funds fresh", { path: "/setup", ready: h1 });
    if (fund) await shot(browser, "test funds ready", { path: "/setup", address: fund.publicKey(), ready: text(/You're ready/) });

    await shot(browser, "overview disconnected", { path: "/overview", ready: text("Connect your wallet to see your escrows") });
    await shot(browser, "overview connected", { path: "/overview", address: live[3].payer, ready: listReady });
    if (fund) await shot(browser, "overview funder", { path: "/overview", address: fund.publicKey(), ready: listReady });
    await shot(browser, "overview arbiter", { path: "/overview", address: live[1].arbiter, ready: listReady });
    await shot(browser, "connect modal", {
      path: "/overview",
      ready: text("Connect your wallet to see your escrows"),
      act: async (page) => {
        await page.locator("button:visible", { hasText: /^Connect( wallet)?$/ }).first().click();
        await page.getByRole("dialog").getByRole("heading", { name: "Connect a wallet" }).waitFor();
      },
    });
    await shot(browser, "wallet ticket", {
      path: "/overview",
      address: fund?.publicKey() ?? live[3].payer,
      ready: listReady,
      act: async (page) => {
        await page.locator('button[aria-label^="Wallet account"]:visible').first().click();
        await page.getByRole("dialog", { name: "Your wallet" }).waitFor();
      },
    });

    await shot(browser, "escrows disconnected", { path: "/escrows", ready: text("Connect to see your escrows") });
    await shot(browser, "escrows paying", { path: "/escrows", address: fund?.publicKey() ?? live[3].payer, ready: listReady });
    await shot(browser, "escrows receiving", {
      path: "/escrows",
      address: live[3].recipient,
      ready: listReady,
      act: async (page) => {
        await page.getByRole("button", { name: /^Receiving/ }).click();
        await page.waitForTimeout(400);
      },
    });
    await shot(browser, "escrows closed", {
      path: "/escrows",
      address: live[1].arbiter,
      ready: listReady,
      act: async (page) => {
        await page.getByRole("button", { name: /^Closed/ }).click();
        await page.waitForTimeout(400);
      },
    });

    await shot(browser, "find found", { path: "/find?id=3", ready: (page) => page.getByRole("link", { name: "Open escrow #0003" }).waitFor({ timeout: 30_000 }) });
    await shot(browser, "find not found", { path: `/find?id=${Number(info.escrowCount) + 50}`, ready: text("No escrow with that number.") });
    await shot(browser, "find invalid", {
      path: "/find",
      ready: h1,
      act: async (page) => {
        await page.getByLabel("Escrow number or link").fill("abc");
        await page.getByRole("button", { name: "Search", exact: true }).click();
        await text(/doesn't look like an escrow number/)(page);
      },
    });

    const payerForNew = fund?.publicKey() ?? live[3].payer;
    await shot(browser, "new disconnected", { path: "/new", ready: h1 });
    await shot(browser, "new empty", { path: "/new", address: payerForNew, ready: h1 });
    await shot(browser, "new filled", {
      path: "/new",
      address: payerForNew,
      ready: h1,
      act: async (page) => {
        await page.locator("#recipient").fill(live[3].recipient);
        await page.locator("#amount").fill("0.5");
        await page.locator("#title").fill("Logo for the café");
        await page.getByRole("switch", { name: "Add an arbiter" }).click();
        await page.locator("#arbiter").fill(live[1].arbiter);
        await page.locator("#title").blur();
      },
    });
    await shot(browser, "new errors", {
      path: "/new",
      address: payerForNew,
      ready: h1,
      act: async (page) => {
        await page.locator("#recipient").fill("GABC");
        await page.locator("#recipient").blur();
        await page.locator("#amount").fill("1,5");
        await page.locator("#amount").blur();
      },
    });
    if (fund) {
      await shot(browser, "new signing", {
        path: "/new",
        address: fund.publicKey(),
        hold: true,
        ready: h1,
        act: async (page) => {
          await page.locator("#recipient").fill(live[3].recipient);
          await page.locator("#amount").fill("0.1");
          await page.getByRole("button", { name: "Create escrow" }).click();
          await text(/Approve in Varial/)(page);
        },
      });
    }

    // Every status × every role.
    const states = [
      ["awaiting deposit", open.created],
      ["funded", open.funded],
      ["in dispute", open.disputed],
      ["released", live[3]],
      ["refunded by recipient", live[4]],
      ["refunded by reclaim", live[2]],
      ["split", live[1]],
      ["cancelled", live[6]],
    ];
    for (const [state, e] of states) {
      if (!e) continue;
      const roles = [
        ["guest", undefined],
        ["payer", e.payer],
        ["recipient", e.recipient],
        ...(e.arbiter ? [["arbiter", e.arbiter]] : []),
        ["stranger", stranger.publicKey()],
      ];
      for (const [role, address] of roles) {
        await shot(browser, `escrow ${state} ${role}`, { path: `/escrow/${e.id}`, address, ready: escrowReady });
      }
    }

    if (open.funded) {
      await shot(browser, "escrow refusal toast", {
        path: `/escrow/${open.funded.id}`,
        address: stranger.publicKey(),
        ready: escrowReady,
        act: async (page) => {
          await page.getByRole("button", { name: "Check other actions" }).click();
          const row = page.locator("#blocked-list").getByRole("listitem").filter({ hasText: /^\s*Release/ }).first();
          await row.getByRole("button", { name: "Try anyway" }).click();
          await text("Rejected by the contract")(page);
        },
      });
      if (fund && open.funded.payer === fund.publicKey()) {
        await shot(browser, "escrow signing", {
          path: `/escrow/${open.funded.id}`,
          address: fund.publicKey(),
          hold: true,
          ready: escrowReady,
          act: async (page) => {
            await page.getByRole("button", { name: /^Release [\d.,]+ USDC$/ }).click();
            await page.getByRole("button", { name: "Yes, release it" }).click();
            await text(/Approve in Varial/)(page);
          },
        });
      }
    }
    if (open.funded && fund && open.funded.payer === fund.publicKey()) {
      await shot(browser, "escrow confirm step", {
        path: `/escrow/${open.funded.id}`,
        address: fund.publicKey(),
        ready: escrowReady,
        act: async (page) => {
          await page.getByRole("button", { name: /^Release [\d.,]+ USDC$/ }).click();
          await text("This can’t be undone.")(page);
        },
      });
    }
    await shot(browser, "escrow not found", { path: `/escrow/${Number(info.escrowCount) + 50}`, ready: text("No escrow with that number.") });

    const dev = await fetch(`${BASE}/dev/notices`).then((r) => r.status).catch(() => 0);
    if (dev === 200) await shot(browser, "dev notices", { path: "/dev/notices", ready: h1 });
    else console.log("  – /dev/notices skipped (not a dev server)");
  } finally {
    await browser.close();
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "screens.json"), `${JSON.stringify({ base: BASE, at: new Date().toISOString(), shots: written, failures, requests: issues.requests }, null, 2)}\n`);
  console.log(`\n${written.length} screenshots in e2e/shots/ (list in e2e/.out/screens.json)`);
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
}

await main();
