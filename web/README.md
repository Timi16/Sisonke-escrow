# Sisonke web

The web app for [sisonke-escrow](../README.md): create, fund and settle USDC escrows on Stellar
Testnet with your own wallet. Next.js 16 (App Router, Cache Components) with Tailwind 4 and
`motion`. The browser reads the contract directly over Soroban RPC and Horizon, and every write is
built, simulated and signed in the browser by the connected wallet through Stellar Wallets Kit.
There are no keys, no database and no server between you and the chain state you act on.

The design is in [`docs/design/`](../docs/design) and the build plan in
[`docs/WEB_PLAN.md`](../docs/WEB_PLAN.md). The rules the app enforces come from
[`docs/CONTRACT.md`](../docs/CONTRACT.md) and [`docs/INTEGRATION.md`](../docs/INTEGRATION.md).

## Quick start

```bash
cd web
pnpm install
pnpm dev           # http://localhost:3000, against the live Testnet contract
pnpm check         # typecheck, lint, unit tests, production build
```

It works with no `.env`: every default comes from `lib/generated/deployment.ts`, a copy of
`../deployments/testnet.env`. Set `NEXT_PUBLIC_*` (see `.env.example`, all public) only to point at
another deployment. Node ≥ 22.18, pnpm 12.8.1.

```bash
pnpm sync          # after scripts/deploy.sh or scripts/e2e.ts changed ../deployments
pnpm bindings      # regenerates web/contract from the deployed contract (feeds a test only)
pnpm e2e           # real-Testnet run through the UI (needs ../scripts/.env and Chrome)
pnpm screens       # every page × desktop/phone screenshots
```

## Routes

| Route | Page |
|---|---|
| `/` | Landing (Main and Phone-Landing boards), with the real Testnet proof for escrow #0003 |
| `/rules` | Rules and proof: who can do what, what the contract refuses, scenarios A–G with real hashes, About this contract |
| `/setup` | Wallet setup in four steps: connect, test XLM (Friendbot), USDC trustline, test USDC (Circle faucet or the Testnet DEX) |
| `/dashboard` | My escrows: paying, receiving and arbiter tabs, filters, stats, spam collapse |
| `/find` | Find an escrow by ID or link (`/find?id=42` searches straight away) |
| `/new` | New escrow: recipient, amount, deadline, optional title and arbiter, one- or two-signature funding |
| `/escrow/[id]` | One escrow: where the money is, what you can do, progress, parties, details, activity |
| `/dev/notices` | Dev server only: every contract notice state (upgrade, paused, wrong network, migration, misconfigured) |

| API | Returns | Cache |
|---|---|---|
| `POST /api/friendbot {address}` | `{ funded, alreadyFunded?, hash }`, Testnet only | none |
| `GET /api/health` | RPC `getHealth` and Horizon reachability | none |
| `GET /api/info` | `info()` (bigints as strings) plus `tokenOk` | 30 s |
| `GET /api/escrow/:id` | `{ escrow, deadlinePassed }` | 10 s |

The API routes are for integrators (and Friendbot's CORS). No page uses them for anything it shows.

## How a transaction runs

Every write goes through `lib/stellar/tx.ts`, one at a time, and shows its progress inline in the
card where it started:

1. **Checking with the contract.** Local pre-checks first (wallet connected, on Testnet, account
   funded, USDC trustline and balance for a deposit), then a free simulation. A call the contract
   would refuse stops here, in plain words, and the wallet never opens. Every authorization entry
   must be the source account's own, or the app refuses to ask for a signature.
2. **Approve in your wallet.** The wallet signs (`signTransaction` only, with the network
   passphrase and address). The app then checks the returned envelope hashes to exactly what was
   prepared and carries a valid signature by your key for this network.
3. **Sending to Stellar.**
4. **Confirmed.** The app polls until the ledger closes, then re-reads the escrow until the read
   includes this transaction. **Status only changes through that read**: nothing is optimistic.

"Try anyway" on an action you can't take only simulates it in enforcing-auth mode and shows the
contract's refusal. Nothing is signed or sent.

## What the app enforces from INTEGRATION.md

- [x] Contract and token ids only from config; startup checks (contract/token ids, RPC network
      passphrase, USDC SAC derived from the issuer, `info().token`) or no escrow data is shown at all.
- [x] Each escrow's `token` must be the pinned USDC before its amount is shown.
- [x] `Created` is labelled **"Awaiting deposit — not funded"** everywhere and never shown as locked.
- [x] Status, amounts and "what's allowed" come from fresh reads and `deadline_passed`; countdowns
      and the dispute cutoff use ledger time, never the browser clock alone.
- [x] Events are history only (with a fallback from stored timestamps past the RPC's ~7-day window).
- [x] Titles render as text, with bidi and zero-width characters stripped and marked.
- [x] Payer, recipient and arbiter always shown in full; the recipient is warned about the payer's
      arbiter, with the arbiter's decision history.
- [x] A non-dismissable upgrade banner on every page while an upgrade is pending, with what each
      role can do alone right now, and a warning when the proposed code isn't published.
- [x] Upgrade notice period, admin and "the code is final" in the footer and on `/rules`; a note on
      `/new` when the deadline is longer than the notice period.
- [x] Likely-spam escrows (tiny, short-lived, reclaimed by their sender) collapse in the receiving
      and arbiter tabs; any escrow can be hidden from your own view.
- [x] Disputes stop being offered 10 minutes before the deadline; receiving trustlines are checked
      before release, refund or a split; every call is simulated first.
- [x] `extend_escrow_ttl` offered for open escrows older than 60 days; `migrate` offered after 141.

## Layout

```
app/                  routes: (site) landing + rules, (app) app pages, (dev) notices, api/
components/ui/        primitives: Button, StatusChip, Card, Field, Segmented, Tabs, Modal, Address, TxHash…
components/layout/    SiteHeader/Footer, AppHeader (+ phone sheet), WalletChip, AppFooter, ContractNotices
components/wallet/    WalletProvider (kit, network check, sign), ConnectModal
components/tx/        TxProvider (one write at a time), TxProgress, TxResult, TxError
components/escrow/    the escrow page pieces, EscrowRow, MissingEscrow
components/landing/   components/rules/   components/setup/
lib/config.ts         NEXT_PUBLIC_* with generated defaults; validated explorer links
lib/sisonke/          types, encoders (contract.ts), decode, reads, events, amount, address, title,
                      deadline, status, actions (role × status × time), copy, errors, notices, spam
lib/stellar/          rpc, tx (the write pipeline), auth, diagnostics, horizon, network checks
lib/hooks/            React Query hooks, the ledger clock
lib/generated/        deployment.ts and proof.json, written by `pnpm sync`
contract/             generated bindings; not imported by the app, its spec feeds a test
```

## Testing

- **Unit tests** (`pnpm test`, Vitest, node environment): amounts (no float maths, never rounds),
  the full role × status × time action matrix against CONTRACT.md, error mapping, titles,
  addresses, deadlines, status wording, notices, spam, the auth and signature checks, every
  `errors.rs` code covered, **encoders byte-equal to the contract's own spec**, generated config
  equal to `deployments/`, and a source scan for raw-HTML sinks.
- **E2E** (`pnpm e2e`, `e2e/app.e2e.mjs`): system Chrome with a Freighter stand-in that answers the
  extension's `postMessage` protocol and asks the Node process to sign, so no secret enters the
  page. Fresh payer, recipient, arbiter and stranger wallets run every flow on real Testnet. The
  funder key comes from `../scripts/.env` (`E2E_FUNDER_SECRET`, else `E2E_PAYER_SECRET`). Every hash
  the app shows is recorded in `e2e/.out/run.json`. Any console error (CSP included) fails the run.
- **Screenshots** (`pnpm screens`, `e2e/screens.e2e.mjs`): every page at 1440×1000 and 390×844
  (DPR 2), full page, into `e2e/shots/<desktop|phone>/<nn>-<name>.png`. Viewing needs no keys: the
  stand-in connects as each escrow's payer, recipient or arbiter address. Open-state fixtures
  (awaiting deposit, funded, in dispute; 0.1 USDC each) are created once in Node and cached in
  `e2e/.out/fixtures.json`. `E2E_VIDEO=1` records video to `e2e/videos/`. `BASE_URL` defaults to
  `http://localhost:3000`; `CHROME_PATH` to the macOS Chrome.

`e2e/.out`, `e2e/shots` and `e2e/videos` are git-ignored. To keep chosen shots, copy them into
`docs/`, for example `cp e2e/shots/desktop/*-escrow-* ../docs/screenshots/`.

## Security notes

- Static CSP and security headers from `next.config.ts` (`connect-src` is only this site, the RPC
  and Horizon; `frame-ancestors 'none'`). It uses the Next docs' "Without Nonces" approach because
  nonces would force every page to render dynamically under Cache Components, so `script-src`
  allows `'unsafe-inline'`. XSS defence rests on React escaping, the lint ban on raw HTML and title
  sanitising.
- No secrets anywhere in `web/`; `/api/friendbot` only calls Friendbot with a validated address.
- Wallet signatures are verified before sending (§ How a transaction runs).

## Photos

The landing photos are in `public/images/` (`hero-payer.jpg`, `hero-recipient.jpg`,
`freelance.jpg`, `market.jpg`, `trade.jpg`), from Unsplash by Vitaly Gariev, Iwaria, Joyce Busola
and Tunde Buremo, with the design boards' alt texts. Replace a file under the same name to change
it.

## Regenerating bindings and deployment data

`pnpm bindings` runs `../scripts/bindings.sh` with `OUT_DIR=web/contract`. `pnpm sync` copies
`../deployments/testnet.env` and `../deployments/testnet-e2e.json` into `lib/generated/`.
`tests/config.test.ts` and `tests/contract-spec.test.ts` fail when either drifts.
