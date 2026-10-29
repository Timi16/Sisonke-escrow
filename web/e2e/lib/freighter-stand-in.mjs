/**
 * A stand-in for the Freighter extension, for e2e runs in system Chrome.
 *
 * It answers Freighter's window.postMessage protocol (what @stellar/freighter-api
 * speaks), so the app's real path runs: Stellar Wallets Kit → Freighter module
 * → the app's tx pipeline. Signing is delegated to this Node process through
 * exposed bindings (__e2eAddress, __e2eSign, __e2eNetwork): no secret key ever
 * enters the page. A wallet can also be "view only" (an address, no key):
 * enough to look at an escrow as its payer, recipient or arbiter.
 */
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";

export const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const DESKTOP = { viewport: { width: 1440, height: 1000 } };
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** Runs in the page before any app code. */
function standIn(seed) {
  window.freighter = true;
  if (seed) {
    // Restores a "connected" session the way the kit itself persists it.
    try {
      localStorage.setItem("@StellarWalletsKit/activeAddress", seed);
      localStorage.setItem("@StellarWalletsKit/selectedModuleId", "freighter");
    } catch {
      /* storage blocked */
    }
  }
  const DETAILS = {
    TESTNET: {
      network: "TESTNET",
      networkName: "Test Net",
      networkUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
    PUBLIC: {
      network: "PUBLIC",
      networkName: "Main Net",
      networkUrl: "https://horizon.stellar.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
    },
  };
  window.addEventListener("message", async (ev) => {
    const d = ev.data;
    if (ev.source !== window || d?.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;
    const reply = (data) =>
      window.postMessage({ source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId: d.messageId, ...data }, window.location.origin);
    const address = await window.__e2eAddress();
    switch (d.type) {
      case "REQUEST_CONNECTION_STATUS":
        return reply({ isConnected: true });
      case "REQUEST_ALLOWED_STATUS":
      case "SET_ALLOWED_STATUS":
        return reply({ isAllowed: true });
      case "REQUEST_ACCESS":
      case "REQUEST_PUBLIC_KEY":
        return reply({ publicKey: address });
      case "REQUEST_NETWORK":
      case "REQUEST_NETWORK_DETAILS": {
        const details = DETAILS[await window.__e2eNetwork()] ?? DETAILS.TESTNET;
        return reply({ ...details, networkDetails: details });
      }
      case "SUBMIT_TRANSACTION":
        try {
          const signed = await window.__e2eSign(d.transactionXdr, d.networkPassphrase ?? d.opts?.networkPassphrase ?? null);
          return reply({ signedTransaction: signed, signerAddress: address });
        } catch {
          return reply({ apiError: { code: -4, message: "User declined access" } });
        }
      default:
        return reply({ apiError: { code: -3, message: `e2e stand-in does not support ${d.type}` } });
    }
  });
}

/**
 * A browser context with a stand-in wallet.
 *   keypair  – signs (null for a view-only wallet; signing then rejects)
 *   address  – defaults to the keypair's public key
 *   connected – pre-seed the kit's session, so the page loads already connected
 *   hold     – never answer signing requests (for screenshots of the signing stage)
 * Returns { ctx, page, wallet }. wallet: { address, keypair, reject, hold, network, signed }.
 */
export async function walletContext(browser, { keypair = null, address, mobile = false, connected = false, hold = false, video, base, issues } = {}) {
  const wallet = {
    keypair,
    address: address ?? keypair?.publicKey(),
    reject: false,
    hold,
    /** "TESTNET" or "PUBLIC": what the wallet reports, and the passphrase it signs for. */
    network: "TESTNET",
    signed: 0,
  };
  const ctx = await browser.newContext({ ...(mobile ? PHONE : DESKTOP), ...(video ? { recordVideo: { dir: video } } : {}) });
  await ctx.exposeFunction("__e2eAddress", () => wallet.address);
  await ctx.exposeFunction("__e2eNetwork", () => wallet.network);
  await ctx.exposeFunction("__e2eSign", async (xdr) => {
    if (wallet.hold) return new Promise(() => {});
    if (wallet.reject || !wallet.keypair) throw new Error("rejected");
    const passphrase = wallet.network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;
    const tx = TransactionBuilder.fromXDR(xdr, passphrase);
    tx.sign(wallet.keypair);
    wallet.signed++;
    return tx.toXDR();
  });
  await ctx.addInitScript(standIn, connected ? wallet.address : null);
  if (base) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  if (issues) watch(page, issues);
  return { ctx, page, wallet };
}

/** Collects console errors (CSP violations included), page errors and failed requests. */
export function watch(page, issues) {
  page.on("console", (m) => {
    if (m.type() === "error") issues.console.push({ step: issues.step, text: m.text().slice(0, 300) });
  });
  page.on("pageerror", (e) => issues.console.push({ step: issues.step, text: `pageerror: ${e.message.slice(0, 300)}` }));
  page.on("response", (r) => {
    if (r.status() >= 400) issues.requests.push({ step: issues.step, text: `${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}` });
  });
}
