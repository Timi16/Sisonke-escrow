/**
 * Records one continuous, human-paced demo video of Sisonke on Testnet:
 * landing → connect wallet → overview → new escrow (create + fund) → escrow page →
 * a refused refund (wrong signer) → release → a refused second release → escrows list → find.
 *
 *   BASE_URL=https://www.sisonkescrow.com pnpm demo
 *
 * The payer is the e2e funder (scripts/.env); signing happens in this Node process
 * through the wallet stand-in, so no secret key enters the page. Spends 1 test USDC.
 * Writes e2e/videos/sisonke-demo.webm (1440×1000).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { BASE, WEB, funder } from "./lib/chain.mjs";
import { CHROME, walletContext } from "./lib/freighter-stand-in.mjs";

const RECIPIENT = process.env.DEMO_RECIPIENT ?? "GDIHHSQVKGOE7R562WNGWZ3U6NXPUMKXXQ4WV2CXS62AA7MMCEY523R2";
const AMOUNT = process.env.DEMO_AMOUNT ?? "1";
const VIDEO_DIR = path.join(WEB, "e2e/videos");
const TX = 120_000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A visible cursor and click ripple, so viewers can follow along (Playwright videos have no cursor). */
function cursor() {
  const add = () => {
    if (document.getElementById("demo-cursor")) return;
    const dot = document.createElement("div");
    dot.id = "demo-cursor";
    Object.assign(dot.style, {
      position: "fixed", left: "-40px", top: "-40px", width: "22px", height: "22px", marginLeft: "-11px", marginTop: "-11px",
      borderRadius: "999px", background: "rgba(90,45,224,0.35)", border: "2px solid #5A2DE0", zIndex: "2147483647",
      pointerEvents: "none", transition: "transform .12s ease",
    });
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { dot.style.transform = "scale(0.6)"; }, true);
    addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
}

async function glide(page, locator) {
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await pause(250);
}
async function click(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await glide(page, locator);
  await locator.click();
}
async function type(page, locator, text, delay = 45) {
  await click(page, locator);
  await locator.pressSequentially(text, { delay });
}
async function scroll(page, dy, steps = 8) {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(60); }
}

async function main() {
  const kp = funder();
  if (!kp) throw new Error("No funder key in scripts/.env");
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const { ctx, page } = await walletContext(browser, { keypair: kp, base: BASE, video: VIDEO_DIR });
  await ctx.addInitScript(cursor);
  page.setDefaultTimeout(45_000);
  const log = (s) => console.log(`  · ${s}`);

  // 1. Landing
  log("landing");
  await page.goto(`${BASE}/`);
  await pause(2500);
  await scroll(page, 900); await pause(1800);
  await scroll(page, 900); await pause(1800);
  await scroll(page, -1800); await pause(1000);
  await click(page, page.getByRole("link", { name: "Open app" }).first());

  // 2. Overview, not connected → connect
  log("overview + connect");
  await page.waitForURL(/\/overview/);
  await pause(2500);
  await click(page, page.locator("button:visible", { hasText: /^Connect wallet$/ }).first());
  const dialog = page.getByRole("dialog");
  await dialog.waitFor(); await pause(2000);
  await click(page, dialog.getByRole("button", { name: /Varial/ }));
  await dialog.getByRole("heading", { name: "Connected" }).waitFor({ timeout: 30_000 });
  await pause(1800);
  await click(page, dialog.getByRole("button", { name: "Continue" }));
  await pause(3500);

  // 3. Wallet ticket
  log("wallet ticket");
  const chip = page.locator('button[aria-label^="Wallet account"]:visible').first();
  if (await chip.isVisible().catch(() => false)) {
    await click(page, chip); await pause(2500);
    await page.keyboard.press("Escape"); await pause(800);
  }

  // 4. New escrow: create and fund in one signature
  log("new escrow");
  await click(page, page.getByRole("link", { name: /New escrow/ }).first());
  await page.waitForURL(/\/new/); await pause(1500);
  await type(page, page.locator("#recipient"), RECIPIENT, 25);
  await type(page, page.locator("#amount"), AMOUNT, 120);
  await click(page, page.getByRole("button", { name: "1 week", exact: true }));
  await type(page, page.locator("#title"), "Logo design, final files", 55);
  const lock = page.getByRole("switch", { name: "Fund now" });
  if ((await lock.getAttribute("aria-checked")) !== "true") await click(page, lock);
  await page.locator("#title").blur();
  await pause(2500);
  await click(page, page.getByRole("button", { name: /^Fund [\d.,]+ USDC$/ }));
  const live = page.getByText(/Escrow #\d+ is live\./);
  await live.waitFor({ timeout: TX });
  const id = /#(\d+)/.exec(await live.innerText())[1];
  log(`escrow #${id} is live`);
  await pause(3000);
  await click(page, page.getByRole("link", { name: "Open the escrow" }));
  await page.waitForURL(new RegExp(`/escrow/${id.replace(/^0+/, "")}$`));
  await pause(3500);

  // 5. A refused attempt: the payer tries the recipient-only refund
  log("refused refund (wrong signer)");
  await scroll(page, 500); await pause(1200);
  const toggle = page.getByRole("button", { name: "Check other actions" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await click(page, toggle);
  await pause(1500);
  const row = page.locator("#blocked-list").getByRole("listitem").filter({ hasText: /^\s*Refund/ }).first();
  await click(page, row.getByRole("button", { name: "Try anyway" }));
  const toast = page.getByRole("alert").filter({ hasText: "Rejected by the contract" });
  await toast.waitFor({ timeout: 30_000 });
  await pause(4000);
  await click(page, toast.getByRole("button", { name: "Dismiss" }));
  await scroll(page, -500); await pause(1000);

  // 6. Release
  log("release");
  await click(page, page.getByRole("button", { name: /^Release [\d.,]+ USDC$/ }));
  await page.getByText("This can’t be undone.").first().waitFor(); await pause(2000);
  await click(page, page.getByRole("button", { name: /^Yes, / }));
  await page.getByText("Confirmed on Stellar.").waitFor({ timeout: TX });
  await pause(3500);
  const doneBtn = page.getByRole("button", { name: "Done", exact: true });
  if (await doneBtn.isVisible().catch(() => false)) await click(page, doneBtn);
  await pause(3500);

  // 7. A refused duplicate: release again on a closed escrow
  log("refused second release (duplicate)");
  if ((await toggle.isVisible().catch(() => false))) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await click(page, toggle);
    const again = page.locator("#blocked-list").getByRole("listitem").filter({ hasText: /^\s*Release/ }).first();
    if (await again.isVisible().catch(() => false)) {
      await click(page, again.getByRole("button", { name: "Try anyway" }));
      const t2 = page.getByRole("alert").filter({ hasText: "Rejected by the contract" });
      await t2.waitFor({ timeout: 30_000 }).catch(() => {});
      await pause(4000);
      await t2.getByRole("button", { name: "Dismiss" }).click().catch(() => {});
    }
  }
  await scroll(page, 700); await pause(2500);
  await scroll(page, -700); await pause(1000);

  // 8. Escrows list and Find
  log("escrows + find");
  await click(page, page.getByRole("link", { name: /^Escrows/ }).first());
  await pause(2000);
  await click(page, page.getByRole("button", { name: /^Closed/ }).first()).catch(() => {});
  await pause(2500);
  await click(page, page.getByRole("link", { name: /Find an escrow/ }).first());
  await type(page, page.getByLabel("Escrow number or link"), String(Number(id)), 120);
  await click(page, page.getByRole("button", { name: "Search", exact: true }));
  await pause(3500);

  const video = page.video();
  await ctx.close();
  await browser.close();
  const src = await video.path();
  const dest = path.join(VIDEO_DIR, "sisonke-demo.webm");
  fs.renameSync(src, dest);
  console.log(`\nEscrow #${id}. Video: ${dest}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
