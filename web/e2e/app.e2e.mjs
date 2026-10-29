/**
 * Sisonke UI end-to-end test, through the real app and the live Testnet contract.
 *
 *   pnpm dev            # or pnpm build && pnpm start
 *   pnpm e2e            # BASE_URL=http://localhost:3000 by default
 *
 * The browser gets a stand-in for the Freighter extension (lib/freighter-stand-in.mjs):
 * the app's real path runs (our ConnectModal → Stellar Wallets Kit → Freighter
 * module → the write pipeline) and every key stays in this Node process.
 * Fresh payer, recipient, arbiter and stranger wallets are onboarded every
 * run. The funder (E2E_FUNDER_SECRET, else E2E_PAYER_SECRET in ../scripts/.env)
 * stands in for Circle's faucet when the DEX has no path, and gets the USDC
 * back at the end. Every transaction hash the app shows goes into
 * e2e/.out/run.json. Any console error (CSP violations included) fails the run.
 */
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { chromium } from "playwright-core";
import {
  BASE,
  OUT as OUT_DIR,
  addTrustline,
  escrowViaApi,
  friendbot,
  fromStroops,
  funder as loadFunder,
  infoViaApi,
  ledgerTime,
  payUsdc,
  recordTx,
  sc,
  simulate,
  txRows,
  usdcOf,
  writeRun,
} from "./lib/chain.mjs";
import { CHROME, walletContext } from "./lib/freighter-stand-in.mjs";

const TX_TIMEOUT = 120_000;
const VIDEO = process.env.E2E_VIDEO === "1" ? new URL("./videos", import.meta.url).pathname : undefined;
const issues = { step: "", console: [], requests: [] };
const results = [];

// ------------------------------------------------------------------ reporting

async function step(name, fn) {
  issues.step = name;
  const started = Date.now();
  const errorsBefore = issues.console.length;
  try {
    await fn();
    const errs = issues.console.slice(errorsBefore);
    if (errs.length) throw new Error(`console errors: ${errs.map((e) => e.text).join(" | ")}`);
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message.split("\n")[0] });
    console.log(`  ✖ ${name}\n      ${err.message.split("\n").slice(0, 8).join("\n      ")}`);
    throw err;
  }
}

function check(cond, message) {
  if (!cond) throw new Error(message);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ------------------------------------------------------------------ UI helpers

async function connect(page, mobile = false) {
  if (mobile) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#phone-sheet").getByRole("button", { name: "Connect wallet" }).click();
  } else {
    // The kit keeps its session in localStorage: a context that connected before is still connected.
    const chip = page.getByRole("button", { name: /Wallet account/ });
    // aria-disabled until the kit has restored any saved session.
    const connectBtn = page.getByRole("banner").locator('button:not([aria-disabled="true"])', { hasText: "Connect wallet" }).first();
    const first = await Promise.race([
      chip.waitFor({ timeout: 30_000 }).then(() => "chip"),
      connectBtn.waitFor({ timeout: 30_000 }).then(() => "connect"),
    ]);
    if (first === "chip") return;
    await connectBtn.click();
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Freighter/ }).click();
  await dialog.waitFor({ state: "detached" });
  if (!mobile) await page.getByRole("button", { name: /Wallet account/ }).waitFor();
}

async function disconnect(page) {
  await page.getByRole("button", { name: /Wallet account/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).first().waitFor();
}

/** "Status: Funded" (the chip's hidden prefix + label). */
const chip = (page, label) => page.getByText(new RegExp(`^Status: ${esc(label)}$`)).first();

async function expectStatus(page, label, timeout = 45_000) {
  await chip(page, label).waitFor({ timeout });
}

/**
 * Waits for the inline transaction card to finish. Returns the hash shown in
 * TxResult; throws with the error card's text if it failed.
 */
async function txDone(page, { step: name, method, escrowId } = {}) {
  const ok = page.getByText("Confirmed on Stellar.");
  const bad = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Try again" }) });
  const winner = await Promise.race([
    ok.waitFor({ timeout: TX_TIMEOUT }).then(() => "ok"),
    bad.waitFor({ timeout: TX_TIMEOUT }).then(() => "bad"),
  ]);
  if (winner === "bad") {
    const text = (await bad.innerText()).replace(/\s+/g, " ");
    const hash = /[0-9a-f]{64}/.exec((await bad.locator("a").first().getAttribute("aria-label").catch(() => "")) ?? "")?.[0] ?? null;
    if (name) recordTx({ step: name, escrowId: escrowId ?? null, method, hash, ok: false });
    throw new Error(`Transaction failed: ${text}`);
  }
  const label = await page.locator("a", { hasText: "Open on Stellar Expert" }).first().getAttribute("aria-label");
  const hash = /[0-9a-f]{64}/.exec(label ?? "")?.[0];
  check(hash, "TxResult shows no transaction hash");
  if (name) recordTx({ step: name, escrowId: escrowId ?? null, method, hash, ok: true });
  return hash;
}

async function done(page) {
  const btn = page.getByRole("button", { name: "Done", exact: true });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

/** A local datetime-local value `secondsAhead` after ledger time, rounded down to the minute. */
async function localIn(secondsAhead) {
  const d = new Date(((await ledgerTime()) + secondsAhead) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fillCreate(page, { recipient, amount, title = "", arbiter, custom, fundNow = false }) {
  await page.goto(`${BASE}/new`);
  await page.locator("#recipient").fill(recipient);
  await page.locator("#amount").fill(String(amount));
  if (custom) {
    await page.getByRole("button", { name: "Pick a date and time" }).click();
    await page.locator("#customDeadline").fill(custom);
  }
  if (title) await page.locator("#title").fill(title);
  if (arbiter) {
    await page.getByRole("button", { name: /Add an arbiter/ }).click();
    await page.locator("#arbiter").fill(arbiter);
  }
  const lock = page.getByLabel(/Lock the USDC now/);
  if (fundNow !== (await lock.isChecked())) await lock.click();
  await page.locator("#title").blur();
}

/** Creates an escrow through /new and lands on its page. Returns its id. */
async function createEscrow(page, opts, name) {
  await fillCreate(page, opts);
  await page.getByRole("button", { name: "Create escrow" }).click();
  const method = opts.fundNow ? "create_and_fund" : "create";
  // /new's done state is "Escrow #N is live." with the creating transaction's hash.
  const live = page.getByText(/Escrow #\d+ is live\./);
  const bad = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Try again" }) });
  const winner = await Promise.race([
    live.waitFor({ timeout: TX_TIMEOUT }).then(() => "ok"),
    bad.waitFor({ timeout: TX_TIMEOUT }).then(() => "bad"),
  ]);
  if (winner === "bad") throw new Error(`Create failed: ${(await bad.innerText()).replace(/\s+/g, " ")}`);
  const label = await page.getByRole("link", { name: /^Open transaction [0-9a-f]{64} on Stellar Expert$/ }).first().getAttribute("aria-label");
  const hash = /[0-9a-f]{64}/.exec(label ?? "")?.[0];
  check(hash, "the create done card shows no transaction hash");
  const id = /#(\d+)/.exec(await live.innerText())[1].replace(/^0+/, "");
  recordTx({ step: name, escrowId: id, method, hash, ok: true });
  await page.getByRole("link", { name: "Go to escrow" }).click();
  await page.waitForURL(new RegExp(`/escrow/${id}$`));
  return id;
}

async function act(page, label, name, method, escrowId) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const hash = await txDone(page, { step: name, method, escrowId });
  await done(page);
  return hash;
}

async function tryAnyway(page, rowLabel) {
  const row = page.getByRole("listitem").filter({ hasText: new RegExp(`^\\s*${esc(rowLabel)}`) }).first();
  await row.getByRole("button", { name: "Try anyway" }).click();
  const toast = page.getByRole("alert").filter({ hasText: "Rejected by the contract" });
  await toast.waitFor({ timeout: 30_000 });
  const text = (await toast.innerText()).replace(/\s+/g, " ");
  await toast.getByRole("button", { name: "Dismiss" }).click();
  return text;
}

async function onboard(page, label, { trustline = true } = {}) {
  await page.goto(`${BASE}/setup`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await connect(page);
  await page.getByRole("button", { name: "Get test XLM" }).click();
  await page.getByText(/test XLM\*?\*? added|Plenty for fees/).first().waitFor({ timeout: 90_000 });
  if (trustline) {
    await page.getByRole("button", { name: "Add trustline" }).click();
    await page.getByText(/USDC trustline added/).first().waitFor({ timeout: TX_TIMEOUT }).catch(async (err) => {
      await page.screenshot({ path: path.join(OUT_DIR, `failure-${label}.png`), fullPage: true }).catch(() => {});
      throw err;
    });
  }
  const now = Number(await page.getByRole("progressbar").getAttribute("aria-valuenow"));
  check(now >= (trustline ? 3 : 2), `${label}: setup progress is ${now}`);
}

async function noHorizontalScroll(page, where) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(extra <= 0, `${where}: page is ${extra}px wider than the viewport`);
}

async function waitDeadlinePassed(id) {
  for (let i = 0; i < 120; i++) {
    const v = await escrowViaApi(id);
    if (v?.deadlinePassed) return;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`escrow #${id}'s deadline never passed`);
}

// ------------------------------------------------------------------ run

async function main() {
  const funder = loadFunder();
  check(funder, "No funder: set E2E_FUNDER_SECRET or E2E_PAYER_SECRET in ../scripts/.env");
  const kp = { payer: Keypair.random(), recipient: Keypair.random(), arbiter: Keypair.random(), stranger: Keypair.random() };
  console.log(`Sisonke UI e2e against ${BASE}`);
  for (const [role, k] of Object.entries(kp)) console.log(`  ${role.padEnd(9)} ${k.publicKey()}`);
  console.log();

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = async (k, opts = {}) => walletContext(browser, { keypair: k, base: BASE, issues, video: VIDEO, ...opts });
  const P = await ctx(kp.payer);
  const R = await ctx(kp.recipient);
  const A = await ctx(kp.arbiter);
  const S = await ctx(kp.stranger);
  const contexts = [P, R, A, S];
  const ids = {};
  let finished = false;

  try {
    await step("1. landing renders and Open app goes to setup", async () => {
      await P.page.goto(BASE);
      await P.page.getByRole("heading", { level: 1 }).waitFor();
      await P.page.getByRole("banner").getByRole("link", { name: "Open app" }).first().click();
      await P.page.waitForURL(/\/setup$/);
    });

    await step("2. payer, recipient and arbiter onboard through /setup", async () => {
      await Promise.all([onboard(P.page, "payer"), onboard(R.page, "recipient"), onboard(A.page, "arbiter", { trustline: false })]);
      // Payer step 4: the DEX first; the funder stands in for Circle if there's no path.
      await P.page.getByRole("button", { name: "Swap XLM for 10 USDC" }).click();
      const swapped = await P.page
        .getByText(/Test USDC\*?\*? is in your wallet/)
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => true)
        .catch(() => false);
      if (!swapped) {
        // 3.5 USDC covers the run: at most 2.6 leaves the payer for good (released, split), and 1 is locked at a time.
        await payUsdc(funder, kp.payer.publicKey(), "3.5000000");
        await P.page.getByRole("button", { name: "I've got my USDC" }).click();
        await P.page.getByText(/Test USDC\*?\*? is in your wallet/).first().waitFor({ timeout: 60_000 });
      }
      await P.page.getByText("You're ready.").waitFor();
      check((await P.page.getByRole("progressbar").getAttribute("aria-valuenow")) === "4", "payer: expected 4/4");
      // The stranger is set up in Node (XLM only; a trustline comes in step 13).
      await friendbot(kp.stranger.publicKey());
      await S.page.goto(`${BASE}/dashboard`);
      await connect(S.page);
    });

    await step("3. /new validates without signing", async () => {
      const page = P.page;
      const signedBefore = P.wallet.signed; // onboarding already signed the trustline (and maybe a swap)
      await page.goto(`${BASE}/new`);
      const field = (id) => page.locator(`#${id}`);
      const errorFor = async (id, value, message) => {
        await field(id).fill(value);
        await field(id).blur();
        await page.getByText(message).first().waitFor({ timeout: 10_000 });
      };
      await errorFor("recipient", "GABC", "That doesn't look like a Stellar address.");
      await errorFor("recipient", kp.payer.publicKey(), "That's your own address. You can't pay yourself.");
      await field("recipient").fill(Keypair.random().secret());
      await field("recipient").blur();
      await page.getByText("That's a secret key. Never paste it anywhere.").first().waitFor();
      check((await field("recipient").inputValue()) === "", "the secret key was not cleared");
      await errorFor("amount", "1,5", "Use a dot for decimals, like 1.50.");
      await errorFor("amount", "1.23456789", "USDC has at most 7 decimal places.");
      await errorFor("title", "😀".repeat(17), "Keep it to 64 bytes.");
      await field("recipient").fill(kp.recipient.publicKey());
      await page.getByRole("button", { name: /Add an arbiter/ }).click();
      await errorFor("arbiter", kp.recipient.publicKey(), "The arbiter must be someone other than you and the recipient.");
      check(P.wallet.signed === signedBefore, "the wallet signed during validation");
    });

    await step("4. a wallet rejection on Create sends nothing", async () => {
      const before = (await infoViaApi()).escrowCount;
      P.wallet.reject = true;
      await fillCreate(P.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "Rejected" });
      await P.page.getByRole("button", { name: "Create escrow" }).click();
      await P.page.getByText("You rejected it in your wallet").waitFor({ timeout: 60_000 });
      P.wallet.reject = false;
      check(/\/new$/.test(P.page.url()), "left /new after a rejection");
      check((await infoViaApi()).escrowCount === before, "an escrow was created after a rejection");
    });

    await step("5. a wallet on the wrong network can look but not sign", async () => {
      P.wallet.network = "PUBLIC";
      await P.page.reload();
      await P.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await P.page.getByText(/Your wallet is on Public network\. Switch it to Testnet to sign\./).waitFor({ timeout: 20_000 });
      const create = P.page.getByRole("button", { name: "Create escrow" });
      check((await create.getAttribute("aria-disabled")) === "true", "Create is not disabled on the wrong network");
      const signed = P.wallet.signed;
      await create.click({ force: true }).catch(() => {});
      await P.page.waitForTimeout(1500);
      check(P.wallet.signed === signed, "the wallet signed on the wrong network");
      P.wallet.network = "TESTNET";
      await P.page.reload();
      await P.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    });

    await step("6. two-step release: create, deposit, release", async () => {
      const id = await createEscrow(P.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "Logo for the café" }, "6 create");
      ids.release = id;
      await expectStatus(P.page, "Awaiting deposit — not funded");
      await P.page.getByText("Nothing locked yet").first().waitFor();
      // Recipient opens the link.
      await R.page.goto(`${BASE}/escrow/${id}`);
      await R.page.getByRole("heading", { name: "Waiting on the payer" }).waitFor();
      // Payer deposits: four stages, then Funded.
      await P.page.getByRole("button", { name: "Deposit 1.00 USDC" }).click();
      await txDone(P.page, { step: "6 fund", method: "fund", escrowId: id });
      const steps = P.page.getByRole("list", { name: "Progress" }).getByRole("listitem");
      check((await steps.count()) === 4, "expected 4 progress steps");
      check((await steps.filter({ hasText: "(done)" }).count()) === 4, "not every stage was marked done");
      await done(P.page);
      await expectStatus(P.page, "Funded");
      await expectStatus(R.page, "Funded"); // by polling
      // The stranger: just looking, no actions; Try anyway is refused by auth.
      await S.page.goto(`${BASE}/escrow/${id}`);
      await S.page.getByRole("heading", { name: "Just looking" }).waitFor();
      check((await S.page.getByRole("button", { name: "Release to recipient" }).count()) === 0, "stranger sees Release");
      const signed = S.wallet.signed;
      const toast = await tryAnyway(S.page, "Release");
      check(/The contract only accepts this from the payer/.test(toast), `unexpected refusal: ${toast}`);
      check(S.wallet.signed === signed, "Try anyway signed something");
      // Release.
      const before = await usdcOf(kp.recipient.publicKey());
      await act(P.page, "Release to recipient", "6 release", "release", id);
      await expectStatus(P.page, "Released");
      const after = await usdcOf(kp.recipient.publicKey());
      check(after - before === 10_000_000n, `recipient got ${fromStroops(after - before)} USDC, expected 1`);
      // Activity lists the three steps with links whose hashes match run.json.
      await P.page.reload();
      for (const title of ["Escrow created", "1.00 USDC locked in", "Released to the recipient"]) await P.page.getByText(title).first().waitFor();
      const links = await P.page.getByRole("link", { name: /^Open transaction [0-9a-f]{64} on Stellar Expert$/ }).evaluateAll((as) => as.map((a) => a.getAttribute("aria-label")));
      for (const want of ["6 create", "6 fund", "6 release"]) {
        const hash = txRows().find((r) => r.step === want)?.hash;
        check(hash, `run.json has no hash for ${want}`);
        check(links.some((l) => l.includes(hash)), `activity has no link for ${want}`);
      }
    });

    await step("7. a second release is refused (101)", async () => {
      const toast = await tryAnyway(P.page, "Release");
      check(/already released\. Nothing pays out twice\./.test(toast), `unexpected refusal: ${toast}`);
    });

    await step("8. one-signature create_and_fund, then the recipient refunds", async () => {
      const id = await createEscrow(P.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "Website copy", fundNow: true }, "8 create_and_fund");
      ids.refund = id;
      await expectStatus(P.page, "Funded");
      await R.page.goto(`${BASE}/escrow/${id}`);
      await act(R.page, "Refund to payer", "8 refund", "refund", id);
      await expectStatus(R.page, "Refunded");
      await R.page.getByText(/The recipient refunded it\./).first().waitFor();
    });

    await step("9. dispute and split", async () => {
      const id = await createEscrow(
        P.page,
        { recipient: kp.recipient.publicKey(), amount: 1, title: "Product photos", arbiter: kp.arbiter.publicKey(), custom: await localIn(16 * 60), fundNow: true },
        "9 create_and_fund",
      );
      ids.split = id;
      await R.page.goto(`${BASE}/escrow/${id}`);
      await R.page.getByText(/The payer picked this arbiter\. If you don't know and trust them, don't start work/).waitFor();
      await act(R.page, "Open a dispute", "9 dispute", "dispute", id);
      await expectStatus(R.page, "In dispute");
      await P.page.reload();
      await P.page.getByRole("listitem").filter({ hasText: /^\s*Reclaim after the deadline/ }).getByText("A dispute is open, so the arbiter decides.").waitFor();
      const [p0, r0] = [await usdcOf(kp.payer.publicKey()), await usdcOf(kp.recipient.publicKey())];
      await A.page.goto(`${BASE}/dashboard`);
      await connect(A.page);
      await A.page.goto(`${BASE}/escrow/${id}`);
      await A.page.getByRole("heading", { name: "Your decision" }).waitFor();
      await A.page.getByLabel("To the recipient").fill("0.6");
      await A.page.getByText(/The recipient gets 0\.60 USDC\. The payer gets 0\.40 USDC\. Result: Split\./).waitFor();
      await act(A.page, "Confirm decision", "9 resolve", "resolve", id);
      await expectStatus(A.page, "Split");
      const [p1, r1] = [await usdcOf(kp.payer.publicKey()), await usdcOf(kp.recipient.publicKey())];
      check(r1 - r0 === 6_000_000n && p1 - p0 === 4_000_000n, `split paid ${fromStroops(r1 - r0)} / ${fromStroops(p1 - p0)}`);
    });

    await step("10. deadline reclaim", async () => {
      const id = await createEscrow(P.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "Deadline reclaim", custom: await localIn(4 * 60) }, "10 create");
      ids.reclaim = id;
      await act(P.page, "Deposit 1.00 USDC", "10 fund", "fund", id);
      await expectStatus(P.page, "Funded");
      await P.page.getByRole("listitem").filter({ hasText: /^\s*Reclaim after the deadline/ }).getByText(/^Opens on /).waitFor();
      const toast = await tryAnyway(P.page, "Reclaim after the deadline");
      check(/The deadline hasn't passed/.test(toast), `unexpected refusal: ${toast}`);
      await waitDeadlinePassed(id);
      // The page flips on its own from a fresh read.
      await P.page.getByRole("button", { name: "Reclaim 1.00 USDC" }).waitFor({ timeout: 60_000 });
      await act(P.page, "Reclaim 1.00 USDC", "10 reclaim", "reclaim", id);
      await expectStatus(P.page, "Refunded");
      await P.page.getByText(/The payer reclaimed it after the deadline\./).first().waitFor();
    });

    await step("11. cancel before any deposit", async () => {
      const id = await createEscrow(P.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "Cancelled" }, "11 create");
      ids.cancel = id;
      await act(P.page, "Cancel escrow", "11 cancel", "cancel", id);
      await expectStatus(P.page, "Cancelled");
      await P.page.getByText("No money ever moved.").first().waitFor();
    });

    await step("12. a deposit without a trustline is stopped before signing", async () => {
      const fresh = Keypair.random();
      await friendbot(fresh.publicKey());
      const F = await ctx(fresh);
      contexts.push(F);
      await F.page.goto(`${BASE}/dashboard`);
      await connect(F.page);
      const id = await createEscrow(F.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "No trustline" }, "12 create");
      const signed = F.wallet.signed;
      await F.page.getByRole("button", { name: "Deposit 1.00 USDC" }).click();
      await F.page.getByText("Your wallet can't hold USDC yet").first().waitFor({ timeout: 30_000 });
      check(F.wallet.signed === signed, "the wallet was asked to sign a doomed deposit");
      // The SAC's own error for this case, checked once in Node.
      const sim = await simulate(fresh.publicKey(), "fund", [sc.u64(id)]);
      check(/Error\(Contract, #13\)/.test(sim ?? ""), `expected SAC error #13, got: ${(sim ?? "success").split("\n")[0]}`);
    });

    await step("13. spam from a stranger collapses in the recipient's list", async () => {
      await addTrustline(kp.stranger);
      await payUsdc(funder, kp.stranger.publicKey(), "0.0000001");
      const id = await createEscrow(
        S.page,
        { recipient: kp.recipient.publicKey(), amount: "0.0000001", title: "You won a prize", custom: await localIn(3 * 60), fundNow: true },
        "13 create_and_fund",
      );
      ids.spam = id;
      await waitDeadlinePassed(id);
      await S.page.getByRole("button", { name: "Reclaim 0.0000001 USDC" }).waitFor({ timeout: 60_000 });
      await act(S.page, "Reclaim 0.0000001 USDC", "13 reclaim", "reclaim", id);
      await R.page.goto(`${BASE}/dashboard`);
      await R.page.getByRole("tab", { name: /receiving/i }).click();
      // Every escrow this run created closed within the hour, so the ones the recipient never signed
      // (released by the payer, reclaimed, the spam) all count as short-lived: expect at least one.
      await R.page.getByText(/\d+ hidden: tiny, short-lived, or taken back by their sender\./).waitFor({ timeout: 40_000 });
      check((await R.page.getByRole("link", { name: new RegExp(`#${String(id).padStart(4, "0")}`) }).count()) === 0, "spam row shown before Show them");
      await R.page.getByRole("button", { name: "Show them" }).click();
      await R.page.getByRole("link", { name: new RegExp(`#${String(id).padStart(4, "0")}`) }).first().waitFor();
    });

    await step("14. /find: found, not found, invalid, link", async () => {
      const page = R.page;
      const find = async (value) => {
        await page.goto(`${BASE}/find`);
        await page.getByLabel("Escrow ID or link").fill(value);
        await page.getByRole("button", { name: "Find it" }).click();
      };
      await find(ids.release);
      await page.getByRole("link", { name: "Open escrow" }).waitFor();
      const missing = Number((await infoViaApi()).escrowCount) + 50;
      await find(String(missing));
      await page.getByText(`No escrow #${String(missing).padStart(4, "0")}`).waitFor();
      await find("abc");
      await page.getByText("That doesn't look like an escrow ID.").waitFor();
      await find(`http://localhost:3000/escrow/${ids.release}`);
      await page.getByRole("link", { name: "Open escrow" }).click();
      await page.waitForURL(new RegExp(`/escrow/${ids.release}$`));
    });

    await step("15. dashboard: tabs, filters, stats, rows", async () => {
      const page = P.page;
      await page.goto(`${BASE}/dashboard`);
      await page.getByRole("tab", { name: /I'm paying\s*\d+/ }).waitFor();
      const paying = Number(/(\d+)/.exec(await page.getByRole("tab", { name: /I'm paying/ }).innerText())[1]);
      check(paying >= 5, `paying count is ${paying}`);
      await page.getByRole("button", { name: "Closed", exact: true }).click();
      await page.getByRole("link", { name: new RegExp(`#${String(ids.cancel).padStart(4, "0")}`) }).waitFor();
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.getByText("Closed for good").first().waitFor();
      await page.getByRole("link", { name: new RegExp(`#${String(ids.release).padStart(4, "0")}`) }).click();
      await page.waitForURL(new RegExp(`/escrow/${ids.release}$`));
      await R.page.goto(`${BASE}/dashboard`);
      await R.page.getByRole("tab", { name: /I'm receiving\s*\d+/ }).waitFor();
      await A.page.goto(`${BASE}/dashboard`);
      await A.page.getByRole("tab", { name: /I'm the arbiter\s*1/ }).waitFor();
    });

    await step("16. phone: create, deposit and release; no horizontal scroll", async () => {
      const M = await ctx(kp.payer, { mobile: true });
      contexts.push(M);
      await M.page.goto(`${BASE}/dashboard`);
      await connect(M.page, true);
      const id = await createEscrow(M.page, { recipient: kp.recipient.publicKey(), amount: 1, title: "Phone" }, "16 create");
      await act(M.page, "Deposit 1.00 USDC", "16 fund", "fund", id);
      await act(M.page, "Release to recipient", "16 release", "release", id);
      await expectStatus(M.page, "Released");
      for (const p of ["/dashboard", "/new", "/find", "/setup", "/rules", "/", `/escrow/${id}`]) {
        await M.page.goto(`${BASE}${p}`);
        await M.page.waitForLoadState("networkidle").catch(() => {});
        await noHorizontalScroll(M.page, p);
      }
    });

    await step("17. disconnect brings the connect prompts back", async () => {
      await P.page.goto(`${BASE}/dashboard`);
      await disconnect(P.page);
      await P.page.getByText("Connect to see your escrows").waitFor();
    });
    finished = true;
  } finally {
    // Send the USDC back to the funder, whatever happened.
    for (const k of [kp.payer, kp.recipient]) {
      const bal = await usdcOf(k.publicKey()).catch(() => null);
      if (bal && bal > 0n) await payUsdc(k, funder.publicKey(), fromStroops(bal)).catch((e) => console.log(`  ! could not return USDC: ${e.message}`));
    }
    const file = writeRun({ escrows: ids, accounts: Object.fromEntries(Object.entries(kp).map(([r, k]) => [r, k.publicKey()])), steps: results, issues });
    for (const c of contexts) await c.ctx.close().catch(() => {});
    await browser.close();
    console.log(`\nWrote ${file}`);
    const passed = results.filter((r) => r.ok).length;
    console.log(`${passed}/${results.length} steps passed${finished ? "" : " (stopped at the first failure)"}`);
    if (issues.requests.length) console.log(`Non-2xx responses:\n  ${issues.requests.map((r) => `${r.step}: ${r.text}`).join("\n  ")}`);
  }
  if (!finished) process.exit(1);
}

await main();
