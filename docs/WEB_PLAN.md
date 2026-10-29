# Sisonke Escrow: web app implementation plan

Plan for the `web/` folder: a Next.js app that lets people create, fund and settle Sisonke escrows on
Stellar Testnet with their own wallet. The Coding agent builds it from this file. The Reviewer and
Adversary agents check the build against it.

**What wins when sources disagree** (highest first):
1. The contract: `contracts/sisonke-escrow/src/*.rs` and [CONTRACT.md](CONTRACT.md).
2. [INTEGRATION.md](INTEGRATION.md). Every "Must" there is a requirement here.
3. This plan, including the copy corrections in §11.
4. The design in `docs/design/*.dc.html`, which is binding for look, layout, motion and copy except
   where §11 corrects it. The people (Megan, Kemi, Tobi…), amounts and hashes in the design are mock
   data. The contract only knows addresses.
5. House style from `/Users/olowutimilehin/Documents/Hodl/web`.

---

## 0. Before writing any code

1. **This Next.js has breaking changes.** Run `pnpm install` in `web/`, then read the relevant guides
   in `web/node_modules/next/dist/docs/` before coding. At minimum read:
   `01-app/01-getting-started/*`, `01-app/02-guides/content-security-policy.md` (section "Without
   Nonces"), `migrating-to-cache-components.md`, `environment-variables.md`, `testing/vitest.md`,
   `testing/playwright.md`, and `01-app/03-api-reference/05-config/01-next-config-js/headers.md`. Heed
   every deprecation notice. Copy `web/AGENTS.md` from Hodl (the `nextjs-agent-rules` block) and add
   the project rules from §8.
2. Read every design board in full, including its `<script>`. Each `class Component extends DCLogic`
   holds the real states, labels and copy (`renderVals`, `defs`, `check`, `info`). The `{{holes}}`
   show which values change.
3. Read `scripts/e2e.ts`. It already encodes every write correctly against this contract with
   `@stellar/stellar-sdk` 17.2.1, decodes simulation and on-chain errors (`describeError`,
   `chainError`), and holds the Friendbot, trustline and DEX top-up code that Setup reuses.
4. Read Hodl's `lib/stellar/*`, `lib/hodl/*`, `components/wallet/WalletProvider.tsx`,
   `components/tx/TxProvider.tsx`, `e2e/app.e2e.mjs`. Port them, then make the changes this plan
   lists.

### Key decisions

| Topic | Decision |
|---|---|
| Stack | Same as Hodl, exact versions: Next 16.4.2 (App Router, `cacheComponents: true`), React 19.3.0, Tailwind 4 via `@tailwindcss/turbopack`, `@creit.tech/stellar-wallets-kit` 2.7.1, `@stellar/stellar-sdk` 17.2.1, `@tanstack/react-query` 5.104.5, `motion` 14.4.0, `react-hook-form` 7.90.0 + `zod` 4.6.7 + `@hookform/resolvers` 6.0.0, pnpm 12.8.1. Dev: `vitest` (latest, pinned exactly), `playwright-core` 1.56.1. |
| Reads | **The browser reads the chain directly** (RPC `simulateTransaction` for contract reads, `getEvents` for history, Horizon for balances) through React Query. No server sits between the user and the chain state they act on. A few read-only API routes exist for integrators and Friendbot (§4.9); the app does not depend on them for any status it shows. |
| Writes | Built and signed in the browser. Source account = the connected wallet, always. Every call needs only the source account's signature, so wallets only ever `signTransaction` (never `signAuthEntry`). |
| Contract encoding | Hand-written typed encoders in `lib/sisonke/contract.ts`. A unit test proves each one produces the same XDR as the contract spec from the generated bindings (§9). The generated client is not imported by app code. |
| Create flow | Matches the design: **two signatures by default** (`create`, then Deposit on the escrow page), so the "Awaiting deposit — not funded" state is real and visible. A checkbox switches to `create_and_fund` (one signature). |
| Tx progress | Inline, in the card where the action started (design), with **4 steps**: Checking, Approve in your wallet, Sending to Stellar, Confirmed. Not a global toast. |
| "Try anyway" | Kept (design), but it only **simulates** in enforcing-auth mode and shows the contract's refusal. Nothing is signed or sent. |
| Time | What is allowed comes from `deadline_passed` in the latest read. Countdowns and the dispute cutoff use ledger time from `getLatestLedger`, never the browser clock alone. |
| Photos | The design's `/_blob/…` images are not in the repo. Ship placeholders at fixed paths (§2.7). The user drops the real Unsplash files in later. |
| Unit tests | Vitest, node environment, for pure logic in `lib/`. |
| E2E and screenshots | `playwright-core` with system Chrome, Hodl's Freighter stand-in, real Testnet transactions, screenshots of every page at 1440×1000 and 390×844. |
| CSP | Static headers in `next.config.ts` (Next docs "Without Nonces"). Nonces would force dynamic rendering of every page under Cache Components. XSS defence rests on React escaping, a lint ban on raw HTML, and title sanitising (§8). |

What changes versus Hodl: no global toast; a role and action matrix in one tested pure module;
deadline state from the chain read instead of the browser clock; CSP and security headers; unit
tests (Hodl had none); contract-spec drift tests; the wallet's signature is checked before
submitting; auth entries are checked to be source-account only; amount parsing refuses ambiguous
commas.

---

## 1. Folder structure (exact)

Mirrors Hodl's `web/`. Route groups: `(site)` for the marketing pages (landing, rules) with the site
header and footer, `(app)` for the app pages with the pill nav header.

```
web/
├── AGENTS.md                      # Next agent-rules block (from Hodl) + §8 rules
├── README.md                      # §10
├── .env.example                   # every NEXT_PUBLIC_* (§10), all public
├── .gitignore                     # Hodl's, plus /e2e/.out /e2e/shots /e2e/videos
├── package.json
├── pnpm-workspace.yaml            # allowBuilds deny-list, copied from Hodl
├── next.config.ts                 # cacheComponents, turbopack tailwind rule, headers() (§8.2)
├── tsconfig.json                  # Hodl's; exclude "contract"
├── eslint.config.mjs              # Hodl's + react/no-danger + restricted-syntax rules (§8.1)
├── vitest.config.ts               # node env, alias "@/" → "./", include "**/*.test.ts"
├── app/
│   ├── layout.tsx                 # fonts (§2.2), metadata, <Providers>
│   ├── globals.css                # tokens, base, utilities, keyframes (§2)
│   ├── icon.svg                   # the two-ring mark (§2.6)
│   ├── not-found.tsx              # design language, link home
│   ├── providers.tsx              # QueryClient, MotionConfig reducedMotion="user", Wallet, Tx
│   ├── (site)/
│   │   ├── layout.tsx             # SiteHeader, ContractNotices, SiteFooter
│   │   ├── page.tsx               # "/"       Main.dc.html + Phone-Landing.dc.html
│   │   └── rules/page.tsx         # "/rules"  Rules.dc.html
│   ├── (app)/
│   │   ├── layout.tsx             # AppHeader, ContractNotices, AppFooter
│   │   ├── setup/page.tsx         # "/setup"  Setup.dc.html
│   │   ├── setup/SetupScreen.tsx
│   │   ├── dashboard/page.tsx     # "/dashboard"  Dashboard.dc.html
│   │   ├── dashboard/DashboardScreen.tsx
│   │   ├── find/page.tsx          # "/find"   Lookup.dc.html
│   │   ├── find/FindScreen.tsx
│   │   ├── new/page.tsx           # "/new"    Create.dc.html
│   │   ├── new/NewEscrowScreen.tsx
│   │   └── escrow/[id]/
│   │       ├── page.tsx           # "/escrow/[id]"  Escrow.dc.html + Phone-Escrow.dc.html
│   │       └── EscrowScreen.tsx
│   ├── (dev)/dev/notices/page.tsx # dev-only preview of every banner state; notFound() in production
│   └── api/
│       ├── friendbot/route.ts     # POST {address}: Testnet only
│       ├── health/route.ts        # GET: RPC + Horizon reachability, not cached
│       ├── info/route.ts          # GET: info() + token check, cached 30 s
│       └── escrow/[id]/route.ts   # GET: get_escrow, cached 10 s
├── components/
│   ├── ui/
│   │   ├── Logo.tsx               # LogoMark + Logo (mark + "sisonke" wordmark)
│   │   ├── Button.tsx             # Button, ButtonLink: variants in §2.5
│   │   ├── StatusChip.tsx         # 7 statuses + "Deadline passed" modifier
│   │   ├── Card.tsx               # Card variants: plain, action, ink, sand, error
│   │   ├── Field.tsx              # Label, Input, AmountInput, Hint, FieldError
│   │   ├── Segmented.tsx          # pill toggles (deadline presets, filters), aria-pressed
│   │   ├── Tabs.tsx               # sliding ink pill tabs (dashboard), roving focus
│   │   ├── Modal.tsx              # focus trap, Esc, restores focus, scroll lock
│   │   ├── Address.tsx            # short mono + full on demand + Copy + Explorer
│   │   ├── TxHash.tsx             # short mono link to /tx/<hash>
│   │   ├── Amount.tsx             # Anton tabular figure + "USDC"
│   │   ├── Countdown.tsx          # ledger-time countdown (useLedgerClock)
│   │   ├── CopyButton.tsx         # "Copy" → "Copied" for 1.6 s
│   │   ├── Notice.tsx             # sand warning row (triangle) and error row
│   │   ├── Skeleton.tsx           # sand blocks; static under reduced motion
│   │   └── icons.tsx              # every inline SVG from the boards, as components
│   ├── layout/
│   │   ├── SiteHeader.tsx         # landing/rules white pill header, anchor nav, "Open app"
│   │   ├── AppHeader.tsx          # app pill nav, Find, Testnet badge, wallet; phone collapse
│   │   ├── WalletChip.tsx         # ink pill + menu (and the phone nav sheet)
│   │   ├── SiteFooter.tsx
│   │   ├── AppFooter.tsx          # contract id, upgrade notice period, admin, "Testnet only"
│   │   └── ContractNotices.tsx    # UpgradeBanner, PausedBanner, WrongNetworkBanner, Misconfigured
│   ├── wallet/
│   │   ├── WalletProvider.tsx     # kit init, address, walletName, network check, sign
│   │   └── ConnectModal.tsx       # the design's "Connect a wallet" modal
│   ├── tx/
│   │   ├── TxProvider.tsx         # one write at a time, stage machine, cache invalidation
│   │   ├── TxProgress.tsx         # 4-step list + dark "waiting for your wallet" card
│   │   ├── TxResult.tsx           # Confirmed: hash, ledger, fee, Stellar Expert link, Done
│   │   └── TxError.tsx            # design error block (shake) with fix link and Try again
│   ├── escrow/
│   │   ├── EscrowHeader.tsx       # breadcrumb, h1, chips, title quote, Copy link
│   │   ├── MoneyStrip.tsx         # "Where the money is": coin, three cells, sentence
│   │   ├── ActionPanel.tsx        # guest / actions / tx / error states (design aside)
│   │   ├── BlockedList.tsx        # "Not yours to do" + Try anyway + refusal toast
│   │   ├── ResolveForm.tsx        # arbiter split form
│   │   ├── ProgressSteps.tsx      # Created → Funded → final
│   │   ├── PartiesCard.tsx        # payer, recipient, arbiter (full addresses) + arbiter warning
│   │   ├── DetailsCard.tsx
│   │   ├── ActivityList.tsx       # events with tx links, retention fallback
│   │   ├── EscrowRow.tsx          # dashboard row
│   │   └── MissingEscrow.tsx      # not found / invalid id card (wobble)
│   ├── landing/                   # Hero, Marquee, RuleFigure, WhyCopy, Audiences, HowItWorks,
│   │                              # RulesTable, ProofCard, Faq, ClosingCta (one file each)
│   ├── rules/                     # StatusTrack, SignerTable, Refusals, PrincipleCards,
│   │                              # ProofGrid, AboutContract (one file each)
│   └── setup/
│       ├── SetupStep.tsx          # numbered card: todo / up next / busy / done / locked
│       └── WalletPicker.tsx       # wallet buttons (shared with ConnectModal)
├── lib/
│   ├── config.ts                  # NEXT_PUBLIC_* with generated fallbacks; explorer helpers
│   ├── cn.ts
│   ├── format.ts                  # dates, short address/hash, padded id "#0042", durations
│   ├── generated/
│   │   ├── deployment.ts          # written by scripts/sync-deployment.mjs, committed
│   │   └── proof.json             # copy of deployments/testnet-e2e.json, committed
│   ├── sisonke/
│   │   ├── types.ts               # Status, PartyRole, Escrow, EscrowView, ContractInfo, events
│   │   ├── contract.ts            # method names + typed ScVal encoders (§4.2)
│   │   ├── decode.ts              # scValToNative → typed objects
│   │   ├── reads.ts               # info, getEscrow, getEscrows, partyIds, sacBalance, codeExists
│   │   ├── events.ts              # escrow history via getEvents
│   │   ├── cached.ts              # "use cache" wrappers for API routes only
│   │   ├── amount.ts              # parse/format USDC ↔ i128 stroops (§8.3)
│   │   ├── address.ts             # account validation and messages
│   │   ├── title.ts               # title validation (create) and sanitising (display)
│   │   ├── deadline.ts            # presets, bounds, dispute cutoff
│   │   ├── status.ts              # labels, chip variant, sentences, money position, steps
│   │   ├── actions.ts             # role × status × time → allowed / blocked (§6)
│   │   ├── copy.ts                # headings, intros, action labels and descriptions
│   │   ├── errors.ts              # every error code → plain words (§5.3)
│   │   ├── notices.ts             # upgrade banner state, per-escrow "you can, alone, now"
│   │   ├── spam.ts                # likely-spam rule (§3.3)
│   │   └── hidden.ts              # per-address hidden ids (localStorage, try/catch)
│   ├── stellar/
│   │   ├── rpc.ts                 # rpc.Server, view(), withRetry, NULL_ACCOUNT
│   │   ├── tx.ts                  # the write pipeline (§5.1)
│   │   ├── auth.ts                # sourceAuth() for enforce-mode probes; assertSourceOnlyAuth()
│   │   ├── diagnostics.ts         # chainError() from Hodl
│   │   ├── horizon.ts             # readiness, trustline flags, strictReceivePaths
│   │   └── network.ts             # startup checks (§4.8)
│   ├── hooks/
│   │   ├── queries.ts             # React Query keys and hooks (§4.4)
│   │   ├── useNow.ts              # Hodl's shared clock
│   │   └── useLedgerClock.ts      # ledger time estimate (§4.5)
│   └── api.ts                     # json(), apiError(), parseId(), isAccount() (Hodl)
├── contract/                      # generated by scripts/bindings.sh (OUT_DIR=web/contract);
│                                  # not imported by the app; its spec feeds a test
├── scripts/sync-deployment.mjs    # ../deployments → lib/generated/*
├── tests/
│   ├── contract-spec.test.ts      # encoders == Spec.funcArgsToScVals (§9)
│   ├── errors-coverage.test.ts    # errors.rs codes == errors.ts entries
│   ├── config.test.ts             # generated deployment == deployments/testnet.env
│   └── no-raw-html.test.ts        # source scan for raw HTML sinks
├── e2e/
│   ├── app.e2e.mjs                # real-Testnet flow (§9.3)
│   ├── screens.e2e.mjs            # every page × viewport × wallet state (§9.4)
│   └── lib/
│       ├── freighter-stand-in.mjs # Hodl's window.postMessage Freighter stand-in
│       └── chain.mjs              # Horizon helpers, USDC funding, report writer
└── public/images/                 # §2.7
```

Unit tests sit next to their module (`lib/sisonke/amount.test.ts` and so on). The repo root
`Makefile` gets `web-dev`, `web-check` (typecheck, lint, test, build) and `web-e2e` targets that
`cd web` and run pnpm.

---

## 2. Design system

### 2.1 Tokens (`app/globals.css`)

`@import "tailwindcss";` then one `@theme` block. These are every value the boards use. No other
hex, shadow or easing values may appear in components: use the tokens.

```css
@theme {
  /* surfaces */
  --color-ground: #F8F4E6;        /* page background, inputs, modal */
  --color-card: #FFFFFF;          /* cards, header pill */
  --color-sand: #EFEADA;          /* chips, current nav, blocked list, subtle fills */
  --color-line: #E6DFCB;          /* card and header borders */
  --color-line-strong: #DDD6C2;   /* input borders, pending step ring, row dividers */
  /* ink */
  --color-ink: #15110A;           /* text, borders, dark panels */
  --color-muted: #5A5446;         /* secondary text */
  --color-faint: #8C8370;         /* placeholders, disabled text only (fails 4.5:1 for body text) */
  /* on ink (dark panels) */
  --color-ink-2: #221D14;         /* cards on ink */
  --color-ink-3: #2E281D;         /* disabled button on ink */
  --color-ink-line: #3A3226;      /* borders on ink */
  --color-ink-btn-line: #6B6252;  /* outline button on ink */
  --color-on-ink: #F8F4E6;
  --color-on-ink-muted: #C9C1AD;
  --color-on-ink-soft: #E4DCC6;
  /* accents */
  --color-lime: #D2F54B;          /* money that is safe, the one main action */
  --color-violet: #5A2DE0;        /* focus, links, the logo lens, "needs you" pulse, disputes */
  --color-lilac: #DDD3FF;         /* text on ink accents; disputed contract cell */
  --color-tomato: #E8492A;        /* the "Go first." stamp, hero dot */
  --color-stamp-text: #FFF8E8;
  --color-olive: #6B6E2E;         /* "Held here" border */
  --color-photo: #E8DEC4;         /* photo placeholder ground (hero) */
  --color-photo-2: #E2D7BA;       /* photo placeholder ground (audiences) */
  /* feedback */
  --color-error: #B5321A;
  --color-error-bg: #FCEDE8;

  --font-sans: var(--font-figtree), "Helvetica Neue", Arial, sans-serif;
  --font-display: var(--font-anton), Impact, sans-serif;           /* always uppercase */
  --font-serif: var(--font-instrument-serif), Georgia, serif;
  --font-mono: var(--font-geist-mono), ui-monospace, Menlo, monospace;

  --radius-pill: 999px;
  --radius-section: 36px;   /* landing dark "one rule" section */
  --radius-panel: 28px;     /* app header pill, money strip, create summary, modal */
  --radius-card: 26px;      /* action card, progress, details, activity */
  --radius-tile: 22px;      /* dashboard rows and stat tiles, blocked list, sign card */
  --radius-menu: 20px;
  --radius-box: 18px;       /* hero photo badges, money cells, toasts, audience photos */
  --radius-note: 16px;      /* warn notes, wallet buttons */
  --radius-field: 14px;     /* inputs, summary cells */
  --radius-icon: 12px;      /* icon tiles */

  --shadow-lift: 0 16px 30px -18px rgba(21,17,10,.5);
  --shadow-lift-row: 0 20px 40px -26px rgba(21,17,10,.5);
  --shadow-lift-setup: 0 18px 40px -24px rgba(21,17,10,.45);
  --shadow-lift-rules: 0 24px 40px -28px rgba(21,17,10,.5);
  --shadow-action: 0 24px 50px -36px rgba(21,17,10,.6);
  --shadow-step-active: 0 18px 40px -28px rgba(21,17,10,.6);
  --shadow-float: 0 24px 50px -24px rgba(21,17,10,.45);
  --shadow-menu: 0 30px 60px -24px rgba(21,17,10,.45);
  --shadow-modal: 0 40px 80px -30px rgba(0,0,0,.6);
  --shadow-stamp: 0 18px 30px -18px rgba(21,17,10,.6);
  --shadow-badge: 0 8px 20px -10px rgba(21,17,10,.5);
  --shadow-coin: 0 10px 22px -10px rgba(21,17,10,.6);
  --shadow-coin-lg: 0 16px 30px -14px rgba(21,17,10,.5);
  --shadow-cta-ring: 0 0 0 4px rgba(210,245,75,.35);
  --shadow-cta-ring-hover: 0 0 0 6px rgba(210,245,75,.45);
  --shadow-lime-glow: 0 0 14px rgba(210,245,75,.8);
  --shadow-held: 0 0 0 10px rgba(210,245,75,.06), 0 0 60px rgba(210,245,75,.18);

  --ease-rise: cubic-bezier(.2,.7,.2,1);
  --ease-coin: cubic-bezier(.65,0,.35,1);
  --ease-travel: cubic-bezier(.6,0,.4,1);
}
```

Base layer: `body { background: var(--color-ground); color: var(--color-ink); font-family:
var(--font-sans); }`; `* { box-sizing: border-box }`; `a { color: ink } a:hover { color: violet }`
(Dashboard rows keep ink on hover); `a, button, input, select, textarea, [tabindex]:focus-visible {
outline: 3px solid var(--color-violet); outline-offset: 3px }`; `::selection { background: lime;
color: ink }`; `input::placeholder { color: faint }`. Add an `@utility tabular` (tabular-nums) and
`@utility display` (Anton, weight 400, uppercase, letter-spacing .01em, line-height 1).

Layout constants from the boards: content `max-width: 1240px`, landing dark section `1376px`, app
main padding `36px 24px 96px`, gaps 24px between app cards, card padding `24px 26px`, phone side
gutter 16px (header 14px, as Phone-Escrow).

### 2.2 Fonts (`app/layout.tsx`, `next/font/google`)

```ts
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: "variable" }); // 400..800 used
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] }); // 400..600 used
```

Put all four `.variable` classes on `<html>`. Fonts are self-hosted at build time, so `font-src
'self'` is enough. Never load Google Fonts at runtime (the boards' `<link>` is design-tool only).

Type roles, taken from the boards:
- **Display (Anton, uppercase):** page h1s (`ESCROW #0042` `clamp(40px,4.6vw,64px)`; landing hero
  `clamp(48px,5.6vw,82px)` and stamp `clamp(52px,6vw,90px)`), primary buttons 21–24px, amounts
  (contract cell `clamp(24px,3.2vw,40px)`, dashboard 30px, stats 52px, amount input 30px).
- **Serif (Instrument Serif 400):** card headings (`Your move` 34px, `Here's the deal` 36px,
  `Connect a wallet` 34px), landing statements `clamp(32px,3.4vw,48px)` and h2s
  `clamp(42px,4.6vw,68px)`, the escrow title quote 26px.
- **Sans (Figtree):** everything else. 15px/700 labels, 15px/1.55 body in `muted`, 13–14px captions.
- **Mono (Geist Mono):** addresses, contract ids, hashes, escrow ids in rows, 12–14px.

### 2.3 Motion (`globals.css`)

Port these keyframes and classes exactly. Where boards differ, keep both as named variants.

| Class | Keyframes / transition | Used for |
|---|---|---|
| `.rise` | translateY(16px)→0, opacity 0→1, `.7s var(--ease-rise) both`; stagger with inline `animation-delay` (40–320 ms, as the boards) | page sections (app) |
| `.rise-lg` | 18px, `.8s` | landing, rules |
| `.rise-fast` | 16px, `.6s` | dashboard |
| `.pop` | scale .5→1.08→1, `.45s ease-rise` | status chip on change, "You" badge, step checks |
| `.pop-strong` | scale .5→1.12→1 | setup and create checkmarks |
| `.slidein` | translateY(-8px)→0, `.4s ease` | panels swapping, notes, menus |
| `.slide-up` | translateY(14px)→0, `.5s ease-rise` | Find result cards |
| `.shake` | translateX ±6px, `.45s` | errors and refusal toast |
| `.bob` | translate(-50%,0)↔(-50%,-4px), `2.4s ease-in-out infinite` | the coin |
| `.spin` | rotate 360, `.9s linear infinite` | spinners |
| `.pulse` | violet ring 0→6px fade, `1.8s infinite` | "needs you" dot |
| `.glow` | lime ring 0→10px fade, `2.2s infinite` | create summary "Contract holds" cell |
| `.wobble` | rotate 0/-8/8deg, `.8s ease-in-out 2` | not-found icon |
| `.stamp` | rotate(-4deg) scale 1.25→.96→1, `.7s ease-rise .5s both` (rules `.45s`, phone `.4s`, scale 1.3→.95) | "Go first.", "in full." |
| `.marquee` | translateX(0→-50%), `32s linear infinite` (phone 22s) | lime band |
| `.pulse-r` / `.pulse-l` | `toRight` / `toLeft` dot travel, `2.8s ease-travel infinite` (`-l` delay 1.4s) | landing rule figure |
| `.travel` | `2.2s ease-travel infinite` | rules status track |
| `.lift` | transition transform/box-shadow .2s; hover translateY(-2px) + `shadow-lift` | cards, buttons |
| `.lift-row` | as `.lift` + border-color ink + `.chev` translateX(4px) | dashboard rows |
| `.lift-rules` | hover translateY(-3px) + `shadow-lift-rules` | rules cards |
| `.cta` | hover translateY(-2px) + `shadow-cta-ring-hover` | landing lime CTAs |
| coin position | `transition: left 1.2s var(--ease-coin)` | MoneyStrip |
| step bar | `transition: width .8s var(--ease-rise)` | ProgressSteps |
| tabs slider | `transition: transform .35s var(--ease-rise)` | Tabs |

**Reduced motion** (one block): under `prefers-reduced-motion: reduce`, every class above gets
`animation: none !important`; `.lift*`, `.cta` hovers get `transform: none`; `.stamp` keeps
`transform: rotate(-4deg)`; `.pulse-r`, `.pulse-l`, `.travel` get `display: none`; the coin, step
bar and tab slider get `transition: none`. `MotionConfig reducedMotion="user"` covers the `motion`
library. The landing hero card cycle (Main board script, phases at 0/900/2500/4100 ms, loop 8600 ms)
does not run under reduced motion and shows all three cards. Use `motion` only for
`AnimatePresence` panel swaps in the action card and list enter/exit. Everything the boards animate
in CSS stays CSS.

### 2.4 Status language (`lib/sisonke/status.ts` + `StatusChip.tsx`)

One chip per status, used on every page. Sizes: header 36px/15px/px-16; row 32px/13px/px-14;
compact 26px/12px/px-11 (landing cards). All 1.5px borders, `radius-pill`, Figtree 700. Each chip
starts with a visually hidden "Status: ".

| Status | Label (exact) | Background | Text | Border |
|---|---|---|---|---|
| `Created` | **Awaiting deposit — not funded** | transparent | ink | 1.5px **dashed** ink |
| `Funded` | Funded | lime | ink | solid ink |
| `Disputed` | In dispute | violet | #FFFFFF | solid ink |
| `Released` | Released | ink | on-ink | solid ink |
| `Refunded` | Refunded | card (#FFF) | ink | solid ink |
| `Split` | Split | sand | ink | solid ink |
| `Cancelled` | Cancelled | transparent | muted | solid line-strong |
| modifier: `Created`/`Funded` with `deadline_passed` | Deadline passed | error-bg | error | solid error |

Dashboard filter buttons may say "Awaiting deposit" (they name a filter, not a status).

### 2.5 Primitives

**Button / ButtonLink** (`variant`, `size`; a `<Link>` when `href` is internal, `<a target="_blank"
rel="noopener noreferrer">` when external):

| Variant | Look | Sizes |
|---|---|---|
| `primary` | lime bg, 1.5px ink border, ink text, display font uppercase, `.lift` | `lg` 58px/21px full-width (action card), `xl` 64px/24px px-34 + `shadow-cta-ring` (hero), `section` 60px/22px px-30 |
| `lime` | lime bg, 1.5px ink border, Figtree 700 | `sm` 40px/14px (header Connect), `md` 48px/15px (fix links) |
| `ink` | ink bg, on-ink text, no border, Figtree 700 | `md` 46px/15px px-24 (Done), `sm` 40px (wallet chip) |
| `outline` | card or transparent bg, 1.5px ink border, Figtree 700 | `md` 46–50px/14–15px (Copy link, Cancel escrow, Open a dispute, Try again, Start another escrow) |
| `ghost` | no border, transparent, violet 13px 700 | 44px tap height (Copy, Explorer) |
| `dashed` | transparent, 1.5px dashed ink, 12px 700 | 44px (Try anyway) |
| `on-ink-outline` | transparent, 1.5px ink-btn-line border, on-ink text | 48px (on dark panels) |
| disabled | on light: sand bg, faint text; on ink: ink-3 bg, faint text; `cursor: not-allowed`, `aria-disabled` plus a reason in text next to it | |

Every interactive element has at least a 44×44px target (header pills are 40px tall with 44px
spacing, as designed).

**Card**: `plain` (card bg, 1px line, radius-card), `action` (1.5px ink border, `shadow-action`,
padding 26px), `ink` (ink bg, on-ink text, radius-panel, padding 30px), `sand` (sand bg,
radius-tile), `error` (error-bg, 1.5px error border, radius-box).

**Header pill nav** (AppHeader, from the Escrow/Dashboard boards): `max-width 1240px`, padding `18px
24px 0`, inner white pill (radius 28px, 1px line, padding `8px 8px 8px 18px`, flex-wrap). Left: Logo
(26px mark, 21px wordmark). Nav: `My escrows`, `New escrow`, `Rules` (40px pills, 15px/600; current
page `aria-current="page"` with sand bg and 700). Right: `Find an escrow` (outline pill with the
search icon, ground bg), **Testnet badge** (sand pill 30px, 7px violet dot, "Testnet"), then
`Connect wallet` (lime sm) or the **WalletChip** (ink pill: 8px dot, lime when the wallet is on
Testnet and error-red when not; wallet name 600; mono short address; chevron).

WalletChip menu (white, radius-menu, `shadow-menu`, 300px, `.slidein`): full address (mono, wraps)
with Copy; "View on Stellar Expert"; network line ("Stellar Testnet" with a check, or "Wrong network:
switch your wallet to Testnet" in error colour); XLM and USDC balances; "Switch wallet" (opens
ConnectModal); "Disconnect" (error colour). The board's "Switch account to try each side" and "Test
the payer's wallet" sections are prototype controls. Drop them.

**Phone header** (below 720px, from Phone-Escrow): sticky, `rgba(248,244,230,.94)` backdrop, padding
`12px 14px`. Logo (20px wordmark) plus one ink pill (the wallet chip, or "Menu" when disconnected).
The pill opens a sheet holding the nav links, Find, the Testnet badge and the wallet section.

**SiteHeader** (Main/Rules): white pill radius 999, padding `10px 10px 10px 20px`, 24px wordmark,
anchor links (`How it works`, `Who it's for`, `FAQ` on `/`; `Who can do what`, `What gets rejected`,
`Proof` on `/rules`) and a lime `Open app` pill (48px, 700). On `/` it links to `/setup`, on `/rules`
to `/dashboard`, as designed.

**Others**: `Address` (short `GCX4…7QPA`, `title` and an expandable full value, Copy, Explorer
link); `TxHash` (short `7c1e…a90b` mono violet link with `aria-label="Open transaction <full hash>
on Stellar Expert"`); `Amount`; `Countdown` ("in 6d 23h", "in 3m 05s", "passed"); `Notice`
(sand radius-note row with the triangle icon, 14px/1.5); `Modal` (ground bg, radius-panel,
`shadow-modal`, backdrop `rgba(21,17,10,.55)`, `.pop`, focus trap, Esc, restores focus, locks
scroll); `Tabs` (white pill track with a sliding ink thumb, `role="tablist"`, arrow keys);
`Segmented` (40px pills, 1.5px border; on = ink bg + on-ink text; off = transparent + line-strong
border).

### 2.6 Logo

```tsx
<svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
  <circle cx="12" cy="17" r="9" fill="none" stroke={ring} strokeWidth={stroke} />
  <circle cx="22" cy="17" r="9" fill="none" stroke={ring} strokeWidth={stroke} />
  <path d="M17 9.52 A9 9 0 0 1 17 24.48 A9 9 0 0 1 17 9.52 Z" fill={lens} />
</svg>
```

Defaults: `ring` ink, `lens` violet, `stroke` 2.4 (the coin uses 2.6). On ink the ring is on-ink.
Wordmark: "sisonke", Figtree 700, letter-spacing -0.03em. The link carries
`aria-label="Sisonke home"`. `app/icon.svg` is the mark on a ground-coloured rounded square.

### 2.7 Images

The boards reference `/_blob/<id>` images that are not in the repo. Use local files at these paths,
via `next/image` with explicit sizes, keeping the boards' `object-position`:

| Path | Board alt text | Photographer credit (footer) |
|---|---|---|
| `public/images/hero-payer.jpg` | "Megan, a café owner in Atlanta, smiling in her apron" | Unsplash, see README |
| `public/images/hero-recipient.jpg` | "Kemi, a designer in Lagos, smiling with her laptop" | |
| `public/images/freelance.jpg` | "A freelancer laughing at her laptop in a café" | |
| `public/images/market.jpg` | "A tomato seller at Bodija Market, Ibadan" | |
| `public/images/trade.jpg` | "A young man grinning and giving the OK sign" | |

Until the user supplies the photos, commit SVG placeholders under the same basenames (`.svg`, on the
`photo` / `photo-2` ground with a simple silhouette and the person's first initial in Anton) and give
them `alt=""` (decorative). README §10 says how to swap in the real photos and restore the alt text.
The landing story keeps the names Megan and Kemi: it is a marketing illustration, not chain data.

---

## 3. Route map

Every app page shares: AppHeader, ContractNotices directly under the header (§6.7), AppFooter
(contract id with Copy and Explorer, "Upgrade notice: 1 hour" from `info.upgrade_delay`, "Code is
final" when `upgrades_locked`, admin address, "Stellar Testnet only. No real funds."). Loading uses
skeletons shaped like the final layout. Any failed read shows a plain error card ("Couldn't reach
Stellar", the reason in one line, and a `Try again` outline button that refetches).

### 3.1 `/` Landing (Main + Phone-Landing)

- **Elements, in order:** SiteHeader; hero (two-span stamped h1, lead, primary xl `Start an escrow`
  → `/new`, `See how it works` → `#how`, wallet line); photo pair with the floating lime coin and
  three cycling status cards (Locked, Delivered, Paid); rotated lime marquee; "Why Sisonke";
  dark "one rule" section with RuleFigure (payer → held here → recipient, pulse dots); audiences
  (three photo cards); How it works (3 steps plus a demo escrow card); rules table; proof card; FAQ
  (one open at a time, `aria-expanded`); closing CTA; SiteFooter.
- **Data:** `info()` (contract id, footer facts); `lib/generated/proof.json` scenario A (escrow #3:
  create → fund → release) fills the proof card with **real** hashes, labels "Escrow created",
  "Payment locked in", "Released to the recipient", "Payer signed, <date>". The card heading uses the
  real id (`Escrow #0003`). The "Contract [CONTRACT ID]" placeholder shows `config.contractId` with
  Copy and Explorer.
- **Copy:** as the board, with the corrections in §11 (hero lead, FAQ answers, rules table rows).
- **Phone (<720px), from Phone-Landing:** a compact header (logo + `Open app`); the hero stack keeps
  only the "Payment released" card; the marquee runs at 22s with `●` separators; RuleFigure switches
  to the three-cell version (Payer, Contract "Held here", Recipient) with no arrows; audiences stack.
  No horizontal scroll at 390px.

### 3.2 `/setup` Wallet setup (Setup)

The four step cards, a progress bar (`role="progressbar"`, `aria-valuenow` = steps done of 4, notes
"Let's go / Nice start / Halfway there / One more / All set"), the "You're ready." banner when 4/4
(links `/new` and `/dashboard`), and the "Why four steps?" / "Already set up?" aside. Full behaviour
is in §7.

### 3.3 `/dashboard` My escrows (Dashboard)

- **Not connected:** an action card "Connect to see your escrows" with `Connect wallet` (primary lg)
  and "Or find an escrow by ID" → `/find`.
- **Elements:** h1 "Your escrows" + lead; `New escrow` ink pill → `/new`; Tabs `I'm paying N`, `I'm
  receiving N`, plus `I'm the arbiter N` only when that count is above 0 (N =
  `party_escrow_count`); filters `All`, `Awaiting deposit`, `Funded` (Funded and Disputed), `Closed`
  (the four final statuses); three stat tiles (ink "Need your attention" with a lime figure, white
  "Locked right now", sand "Closed for good"); rows; the empty state.
- **Data:** per role, `party_escrow_count(address, role)`, then the newest pages of
  `party_escrow_ids(address, role, page)` (last page first) up to the newest 100 ids, then
  `get_escrows` in batches of at most 20, sorted by id descending. `Show older escrows` loads the
  next 100. Refetch every 20 s.
- **Row** (EscrowRow, `.lift-row`, whole row is a link to `/escrow/<id>`): mono `#0042`; title as
  sanitised text ("Untitled escrow" in muted when empty); counterparty line (`to G…` / `from G…` /
  `between G… and G…` for the arbiter tab); Anton amount + "USDC" (only if `escrow.token ==
  info.token`, else "Unknown token, amount hidden"); StatusChip (row size, plus the Deadline passed
  modifier); hint text with the violet `.pulse` dot when the row needs the user; chevron. Hints:

  | Status | Paying | Receiving | Arbiter |
  |---|---|---|---|
  | Created | "Deposit to lock it" (needs you) · past deadline: "Too late to deposit. Cancel it" (needs you) | n/a (recipients only list funded escrows) | n/a |
  | Funded | "Release when the work is in" (needs you) · past: "Deadline passed. Release or reclaim" (needs you) | "Locked. Safe to start work" (needs you) · past: "Deadline passed. The payer can take it back" | "No dispute" |
  | Disputed | "In dispute. The arbiter decides" | "In dispute. The arbiter decides" | "Your decision" (needs you) |
  | Released | "Paid out" | "You got paid" | "Closed" |
  | Refunded | `closed_by` recipient: "Came back to you" · payer: "You took it back" · arbiter: "The arbiter returned it" | recipient: "You sent it back" · payer: "The payer took it back" · arbiter: "The arbiter returned it" | "Closed" |
  | Split | "Split by the arbiter" | "Split by the arbiter" | "Closed" |
  | Cancelled | "Cancelled" | n/a | n/a |

- **Stats** count the current tab: needs-you rows, Funded + Disputed rows, final rows.
- **Spam handling (INTEGRATION §7)** in the receiving and arbiter tabs. `lib/sisonke/spam.ts`
  returns `likelySpam` when the user never signed on the escrow (`closed_by != me` and `disputed_by
  != me`) **and** any of: `amount < 100_000` stroops (0.01 USDC); final and `closed_at - created_at
  < 3600`; or `Refunded` with `closed_by == payer` (reclaimed by its own payer). Those rows collapse
  into one sand row at the bottom: "N hidden: tiny, short-lived, or taken back by their sender."
  with `Show them`. Every row also has a small `Hide` text button (and the escrow page has "Hide
  from my list"). Hidden ids are stored per address in `localStorage` (`sisonke:hidden:<address>`),
  wrapped in try/catch, and are only a view preference.
- **Empty:** the board's empty card. A brand-new wallet gets "No escrows yet" + `Start an escrow`.
  A filter with no match gets "Nothing here yet / Try another filter, or start a new escrow."

### 3.4 `/find` Find an escrow (Lookup)

- **Elements:** h1 "Find an escrow." + lead; labelled input "Escrow ID or link" + `Find it`;
  "Try one:" chips; the searching line ("Checking the contract on Stellar…" with spinner); found
  card; not-found card (`.wobble`); invalid alert.
- **Input parsing** (`parseEscrowQuery`): trim. Accept `42`, `#42`, `#0042`, or any text containing
  `/escrow/<digits>`; take the digits only (`^\d{1,15}$`, value ≥ 1). Anything else is invalid:
  "**That doesn't look like an escrow ID.** IDs are numbers, like 42, or a Sisonke escrow link." The
  app never navigates to a pasted URL. It only extracts the number. `/find?id=42` prefills the box
  and searches.
- **Data:** `info().escrow_count` (an id above it is not found without a call), then `get_escrow(id)`
  (error 100 → not found). "Try one:" chips show the three newest ids (`escrow_count`,
  `escrow_count - 1`, `escrow_count - 2`) and are hidden when the count is 0.
- **Found card:** id, title (sanitised), StatusChip; Payer / Recipient columns (short addresses with
  Copy); Amount; sentence (§6.5); `Open escrow` primary lg → `/escrow/<id>`; "Viewing doesn't need a
  wallet. Acting does."
- **Not found:** "No escrow #0099" + the board's three bullet checks.

### 3.5 `/new` New escrow (Create)

- **Not connected:** the board's slide-in bar "Connect a Stellar wallet to create an escrow." with
  `Connect wallet` (opens ConnectModal) and a Setup link. The form still renders, disabled.
- **Form** (react-hook-form + zod; the zod refinements call the shared validators in `lib/sisonke`,
  validate on blur and on submit):
  1. **Who are you paying?** `#recipient`, placeholder `G…`, hint "Their Stellar address. Starts with
     G, 56 characters." Errors in §8.3.
  2. **How much?** `#amount` (Anton 30px, `inputmode="decimal"`, "USDC" suffix). Hint "Balance:
     1,000.00 test USDC" from Horizon (or "No USDC yet. Get test USDC in setup."). Errors in §8.3,
     plus "That's more than your balance of X USDC." when above the balance.
  3. **Deadline** (`fieldset`): Segmented `3 days`, `7 days` (default), `14 days`, `30 days`, `Pick a
     date and time`, which reveals a `datetime-local` (`#customDeadline`, local time). Line: "If the
     money is still locked after <date, time>, you can take it back." Bounds in §8.3.
  4. **What's it for?** `Optional`, `#title`. Hint "Anyone with the escrow link can read this." and
     a live counter "12 / 64 bytes". Errors in §8.3.
  5. **Add an arbiter** (`Optional`, collapsed `<details>`-style disclosure, design language: outline
     pill toggle). Inside: `#arbiter` (`G…`) and the note "Someone you both trust to decide if you
     disagree. They can split the money only after one of you opens a dispute. The recipient should
     only start work if they trust them too. Without an arbiter there's no dispute: the money moves
     only by your release, their refund, or your reclaim after the deadline."
  6. **Lock the USDC now, in the same signature** checkbox (default off). Off: `create`. On:
     `create_and_fund`.
  `terms_hash` is always `None` (deferred, §12).
- **Summary aside** ("Here's the deal", ink card): the You / Contract holds (`.glow`) / Recipient
  row; bullets "You lock **X USDC** in the Sisonke contract." (with the toggle off: "After you
  deposit, X USDC is locked in the Sisonke contract."), "Only you can release it to <short>.", "<short>
  can refund it to you at any time.", "If it's still locked on <deadline>, you can take it back.",
  plus, with an arbiter, "If either of you opens a dispute before the deadline, <arbiter short>
  decides the split.", plus the **upgrade-delay note** (hollow dot) whenever `deadline -
  ledgerNow > info.upgrade_delay`: "This contract's code can be upgraded after a public
  <1 hour> notice. If that ever happens before <deadline>, you could only get your money back early
  through <short>'s refund<, or the arbiter>. Pick a shorter deadline if you want to be able to
  leave on your own." Then `Create escrow` (primary lg on ink; disabled style ink-3/faint) with the
  hint "Connect your wallet to continue." / "Add a valid address and amount to continue." / "Two
  signatures: this one creates it, the next deposits." / (toggle on) "One signature creates it and
  locks the USDC."
- **Working:** the aside swaps to TxProgress (4 steps, §5.2). The third and fourth sub-lines say
  "Status: Awaiting deposit — not funded." or "Status: Funded."
- **Done:** "Escrow #0043 is live." with the real id from the return value; "Created in transaction
  <TxHash>. Deposit next so the recipient can see the money is locked." (or "…and the USDC is
  locked."); `Go to escrow` (lime) → `/escrow/<id>`; `Create another` (resets the form).
- **Blocks:** contract paused (PausedBanner, button disabled, "New escrows are paused right now.");
  ledger clock not loaded ("Checking Stellar's clock…"); wrong network (§8.4).

### 3.6 `/escrow/[id]` Escrow (Escrow + Phone-Escrow), the most important page

`page.tsx` follows Hodl: `generateMetadata` returns `Escrow #<id> · Sisonke` (never the title, no
chain read), and the screen reads `params` inside `<Suspense fallback={<EscrowSkeleton/>}>`.

- **Elements, desktop order (board):** breadcrumb `My escrows / Escrow #0042`; EscrowHeader (h1
  `ESCROW #0042` + StatusChip(s) with `.pop` on change + title quote + Copy link button); MoneyStrip;
  then a `flex-direction: row-reverse; flex-wrap: wrap` row: the **aside** (`flex: 1 1 360px`:
  action card, refusal toast, BlockedList) and the **main column** (`flex: 999 1 560px`:
  ProgressSteps, PartiesCard, DetailsCard, ActivityList).
- **Phone (Phone-Escrow):** the same markup wraps. Order: back link `My escrows`, heading, money
  strip (three columns kept), actions, Not yours to do, progress, activity, details. The parties
  card sits after actions. Keep the 3-column money grid down to 360px.
- **Data:** `get_escrow(id)` every 10 s, and immediately when ledger time crosses the deadline (+6 s)
  so `deadline_passed` flips from a read; `info()`; ledger clock; `getEvents` history (15 s);
  Horizon readiness for the viewer and trustlines for both parties (for pre-checks); arbiter history
  (§6.6).
- **Actions:** §6.
- **States:** skeleton; invalid id or error 100 → MissingEscrow (Find's not-found card, "No escrow
  #0099", plus a Find box); token mismatch (`escrow.token != info.token`) → the card "This escrow
  uses a token Sisonke doesn't recognise. Its amount isn't shown." (no actions); RPC failure → error
  card + Try again.
- **Copy link:** copies `${location.origin}/escrow/<id>`. Label: payer "Copy link for the
  recipient", recipient "Copy link for the payer", others "Copy link"; then "Link copied" for 1.6 s.
- **Details card** (dl, auto-fit 200px columns): Escrow ID; Amount; Deadline (date and time in local
  time with the zone, e.g. "7 Nov 2026, 14:00 WAT", plus Countdown, or "Passed" when
  `deadline_passed`); Created (`created_at`); Network "Stellar Testnet"; Token "USDC issued by
  Circle" + short SAC id + Explorer; Contract (short + Copy + Explorer, full id in `title`); Terms
  hash ("None"). For open escrows whose `created_at` is over 60 days old: a ghost `Keep this escrow
  stored` button calling `extend_escrow_ttl(id)` (INTEGRATION §9).

### 3.7 `/rules` Rules and proof (Rules)

- **Elements:** SiteHeader (rules anchors); hero h1 "The rules," + stamp "in full."; lead;
  StatusTrack (Awaiting deposit → Funded → Released or Refunded, `.travel`), extended with a second
  muted line "With an arbiter: Funded → In dispute → Released, Refunded or Split. Unfunded escrows
  can be Cancelled."; "Who can do what" table; "What the contract refuses" list; three principle
  cards; proof; About this contract; SiteFooter.
- **Signer table** (exact rows; Status after uses StatusChip compact):

  | Action | Who signs | Allowed when | Money moves | Status after |
  |---|---|---|---|---|
  | Create | Payer | Amount above zero, recipient isn't the payer, deadline in the future and within 365 days | Nothing yet | Awaiting deposit — not funded |
  | Deposit | Payer | Awaiting deposit, before the deadline, not paused | Payer to contract | Funded |
  | Cancel | Payer | Awaiting deposit, any time | Nothing | Cancelled |
  | Release | Payer only | Funded or in dispute | Contract to recipient, full amount | Released |
  | Refund | Recipient only | Funded or in dispute | Contract to payer, full amount | Refunded |
  | Reclaim | Payer only | Funded, deadline passed, no dispute | Contract to payer, full amount | Refunded |
  | Dispute | Payer or recipient | Funded, before the deadline, arbiter named | Nothing | In dispute |
  | Resolve | Arbiter only | In dispute | Split as the arbiter decides | Released, Refunded or Split |
  | View | Anyone | Always | Nothing | No change |

- **Refusals list:** the board's seven items plus "A dispute on an escrow with no arbiter, or after
  the deadline." and "A decision by anyone except the escrow's arbiter, or before a dispute."
- **Principle cards:** "No back door" with corrected copy (§11), "Status follows the chain", "Why the
  payer can reclaim" (append: "…if no dispute was opened before it.").
- **Proof:** contract id and deploy tx (`SISONKE_DEPLOY_TX` from the generated deployment) as links.
  One `.lift-rules` card per scenario in `proof.json` (A to G; D's rows attach to the escrows they
  hit), titled with the board's style ("Escrow A" → "A. Two-step happy path"). The header chip is
  the final status, or "N refused". Rows: step label, ✅/⛔ with the result (decoded error names in
  plain words), TxHash. Failed transactions are links too: they were submitted on-chain. Buttons:
  `Open the contract on Stellar Expert`, `Call it yourself in Stellar Lab` (lab.stellar.org),
  `Source code` (`NEXT_PUBLIC_REPO_URL`, hidden when unset).
- **About this contract (new section, INTEGRATION §2):** version / storage version, admin (Address),
  upgrade notice period (`upgrade_delay`, e.g. "1 hour"), "Upgrades: enabled" or "The code is final",
  total locked (`total_locked`) and the contract's USDC balance (SAC `balance(contract)`), escrow
  count, wasm hash (generated `SISONKE_WASM_HASH`) with the verification command from UPGRADES.md
  "Shipping a v2" step 6.

---

## 4. Data layer

### 4.1 Config (`lib/config.ts`)

Hodl's shape. Each value is `process.env.NEXT_PUBLIC_X ?? generated.X`, where `lib/generated/deployment.ts`
is written by `scripts/sync-deployment.mjs` from `../deployments/testnet.env` (plus `SISONKE_DEPLOY_TX`,
`SISONKE_WASM_HASH`, `SISONKE_ADMIN`, `SISONKE_UPGRADE_DELAY`, `SISONKE_SOURCE_REV`) and copies
`../deployments/testnet-e2e.json` to `lib/generated/proof.json`. The generated files are committed,
so `web/` builds on its own (Vercel root = `web/`). `config.test.ts` fails when they drift from
`deployments/`. Export `explorer.tx(hash)`, `explorer.account(g)`, `explorer.contract(c)`; each
validates its input (64 hex chars, `StrKey` account, `StrKey` contract) and throws otherwise.

Constants: `USDC_DECIMALS = 7`, `MAX_BATCH = 20`, `PAGE_SIZE = 50`, `MAX_TITLE_BYTES = 64`,
`MAX_DURATION = 365 * 86_400`, `DISPUTE_CUTOFF = 600`, `MIN_DEADLINE_LEAD = 120`,
`SPAM_MIN_AMOUNT = 100_000n`, `SPAM_SHORT_LIFE = 3600`, `TTL_BUMP_AGE = 60 * 86_400`.

### 4.2 Contract functions the app calls (`lib/sisonke/contract.ts`)

Exact names, argument names and types from `lib.rs`. Encoders:

```ts
const u64 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "u64" });
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const address = (a: string) => nativeToScVal(a, { type: "address" });       // scvAddress
const string = (s: string) => nativeToScVal(s, { type: "string" });         // scvString (UTF-8)
const none = () => xdr.ScVal.scvVoid();                                     // Option::None
const optAddress = (a: string | null) => (a ? address(a) : none());         // Some(x) encodes as x
const partyRole = (r: "Payer" | "Recipient" | "Arbiter") =>
  xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(r)]);                               // unit enum variant
const u64Vec = (ids: bigint[]) => xdr.ScVal.scvVec(ids.map(u64));
```

**Reads** (simulation; source `NULL_ACCOUNT` = `new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0")`, as Hodl):

| Function | Args (ScVal) | Returns | Used by |
|---|---|---|---|
| `info()` | none | `ContractInfo` map: `version` u32, `storage_version` u32, `admin` Address, `pending_admin` Option<Address>, `token` Address, `paused` bool, `upgrades_locked` bool, `escrow_count` u64, `total_locked` i128, `upgrade_delay` u64, `pending_upgrade_hash` Option<BytesN<32>>, `pending_upgrade_eta` Option<u64>, `pending_upgrade_expires_at` Option<u64> | every page (notices, footer, checks) |
| `get_escrow(id)` | `id` u64 | `EscrowView { escrow: Escrow, deadline_passed: bool }`; error 100 | escrow page, find |
| `get_escrows(ids)` | `ids` Vec<u64>, ≤ 20 (else 127); unknown ids skipped | Vec<EscrowView> | dashboard, arbiter history |
| `party_escrow_count(party, role)` | `party` Address, `role` PartyRole | u32 | dashboard tabs, arbiter history |
| `party_escrow_ids(party, role, page)` | Address, PartyRole, `page` u32 | Vec<u64> (≤ 50; payer: creation order; recipient and arbiter: funding order) | dashboard, arbiter history |
| USDC SAC `balance(id)` | `id` Address (the Sisonke contract) | i128 | rules "About" |

`token()`, `admin()`, `upgrade_delay()`, `upgrades_enabled()`, `is_paused()`, `pending_upgrade()` and
`escrow_count()` are all covered by `info()`. Don't call them separately. Extra RPC reads:
`getLatestLedger` (ledger clock), `getHealth` (event retention), `getNetwork` (passphrase check),
`getEvents`, and `getLedgerEntries` for `xdr.LedgerKey.contractCode({ hash })` (is the proposed wasm
published).

**Writes** (source = connected wallet, which is also the only signer):

| Function | Args, in order (ScVal) | Returns | Who |
|---|---|---|---|
| `create` | `payer` Address (= wallet), `recipient` Address, `arbiter` Option<Address>, `amount` i128 (stroops), `deadline` u64 (unix s), `title` String, `terms_hash` Option<BytesN<32>> (always Void) | u64 id | payer |
| `create_and_fund` | same as `create` | u64 id | payer |
| `fund` | `id` u64 | void | payer |
| `release` | `id` u64 | void | payer |
| `refund` | `id` u64 | void | recipient |
| `reclaim` | `id` u64 | void | payer |
| `dispute` | `id` u64, `by` Address (= wallet) | void | payer or recipient |
| `resolve` | `id` u64, `recipient_amount` i128 | void | arbiter |
| `cancel` | `id` u64 | void | payer |
| `extend_escrow_ttl` | `id` u64 | void | anyone |
| `migrate` | none | void | anyone, only offered after error 141 |

Classic operations (same pipeline, no simulation): `Operation.changeTrust({ asset: USDC })` and
`Operation.pathPaymentStrictReceive` XLM → USDC to self (§7).

Type the method name as a string union of the names above. `invoke()` refuses anything else.

### 4.3 Decoding (`lib/sisonke/decode.ts`, `types.ts`)

`scValToNative` gives snake_case objects. Normalise into:

```ts
type Status = "Created" | "Funded" | "Disputed" | "Released" | "Refunded" | "Split" | "Cancelled";
interface Escrow {
  id: bigint; payer: string; recipient: string; arbiter: string | null; token: string;
  amount: bigint; deadline: number; title: string; termsHash: string | null /* hex */;
  status: Status; createdAt: number; createdLedger: number; fundedAt: number; disputedAt: number;
  disputedBy: string | null; closedAt: number; closedBy: string | null;
  paidToRecipient: bigint; paidToPayer: bigint; updatedLedger: number;
}
interface EscrowView { escrow: Escrow; deadlinePassed: boolean }
```

Rules: unit enum variants decode as `["Funded"]` (take `[0]`, accept a bare string too); `Option`
None decodes as `null`/`undefined` (normalise to `null`); u64/i128 arrive as bigint (timestamps and
ledgers become `number` after a range check, amounts stay bigint); BytesN arrives as a Buffer
(hex-encode); reject any unknown status string (throw, so the page shows an error rather than
guessing). `ContractInfo` gets the same treatment (`upgradesLocked`, `pendingUpgrade: { hash, eta,
expiresAt } | null`).

### 4.4 Queries (`lib/hooks/queries.ts`)

| Key | Fn | Interval |
|---|---|---|
| `["info"]` | `getInfo()` + startup checks | 30 s |
| `["ledger"]` | `getLatestLedger()` | 15 s |
| `["escrow", id]` | `getEscrow(id)` | 10 s |
| `["history", id]` | `getEscrowHistory(id, createdLedger)` | 15 s |
| `["party", address, role]` | count + pages + `get_escrows` | 20 s |
| `["arbiterStats", arbiter]` | §6.6 | 60 s |
| `["readiness", address]` | Horizon balances, trustline flags | 15 s (5 s on /setup while a step is waiting) |
| `["trust", address]` | Horizon USDC trustline of a counterparty | 60 s |

QueryClient defaults as Hodl (`staleTime 5_000`, `retry 2`, refetch on focus). `withRetry` retries
only transport errors (status undefined or ≥ 500), never contract errors.

### 4.5 Ledger time (`useLedgerClock`)

`{ closeTime, fetchedAt }` from `getLatestLedger()`; `ledgerNow() = closeTime + (Date.now() -
fetchedAt) / 1000`. Use it for countdowns, preset deadlines, the dispute cutoff, the
upgrade-banner countdown, and scheduling a refetch at the deadline. **Allowed actions use
`deadline_passed` from the latest read** (INTEGRATION §3). `useNow` (Hodl) drives re-renders; it
returns null on the server and during hydration, so countdowns render a placeholder first.

### 4.6 Event history (`lib/sisonke/events.ts`)

- Filter: `{ type: "contract", contractIds: [config.contractId], topics: [[symbol("sisonke") XDR
  base64, "*", u64(id) XDR base64]] }`.
- `startLedger = max(escrow.createdLedger, getHealth().oldestLedger)`; `truncated = createdLedger <
  oldestLedger`. Page with `cursor`, `limit: 100`, until a short page arrives.
- Parse `topic[1]` as the action (`created`, `funded`, `released`, `refunded`, `reclaimed`,
  `disputed`, `resolved`, `cancelled`) and `value` as the data map (CONTRACT.md "Events"). Keep
  `txHash`, `ledger`, `ledgerClosedAt`. Ignore unknown actions.
- Rows (ActivityList, the board's dot styles), oldest first:

  | Event | Title | By line |
  |---|---|---|
  | created | Escrow created | Payer signed |
  | funded | X USDC locked in | Payer signed |
  | released | Released to the recipient | Payer signed |
  | refunded | Refunded to the payer | Recipient signed |
  | reclaimed | Taken back by the payer after the deadline | Payer signed |
  | disputed | Dispute opened | Payer signed / Recipient signed |
  | resolved | Arbiter decided: X to the recipient, Y to the payer | Arbiter signed |
  | cancelled | Cancelled before any deposit | Payer signed |

  "You signed" replaces the role when the signer is the viewer. Then `, <24 Oct 2026, 10:14>` and
  TxHash. Dots: created white + ink ring, funded lime, released ink, refunded/reclaimed sand,
  disputed violet, resolved half lime, cancelled line-strong.
- **Retention fallback:** when `truncated`, or an expected step has no event, build the missing
  rows from the stored `created_at`, `funded_at`, `disputed_at`, `closed_at`, `closed_by`, with no
  hash, and add the note: "Older steps are past the ~7-day window Stellar's RPC keeps. Their times
  come from the contract record. See every transaction on Stellar Expert." (contract explorer
  link). Events are never used for amounts or status (INTEGRATION §4).
- After a confirmed write, put that transaction's row in at once from the result (hash, ledger,
  time), then let the refetch replace it.

### 4.7 Horizon (`lib/stellar/horizon.ts`)

Port Hodl's `getReadiness` (`/accounts?signer=` so unfunded accounts don't log 404s), and extend it
to return `{ exists, xlm, usdc: { balance, authorized } | null }` (`is_authorized` false =
frozen). Balances stay strings and go through `parseAmount` for comparisons, never `Number`. The
same helper serves counterparty trustline checks. `findUsdcPath(destAmount)` wraps
`strictReceivePaths([Asset.native()], USDC, amount)` as in `scripts/e2e.ts`.

### 4.8 Startup checks (`lib/stellar/network.ts`, run with the `info` query)

Any failure renders **Misconfigured** in place of the page content (no escrow data is shown at all;
INTEGRATION §1):
1. `StrKey.isValidContract(config.contractId)` and `config.usdcSacId`.
2. `rpc.getNetwork().passphrase === config.networkPassphrase`.
3. `new Asset("USDC", config.usdcIssuer).contractId(config.networkPassphrase) === config.usdcSacId`.
4. `info.token === config.usdcSacId`. Copy: "This app is pointed at a contract that doesn't use
   Testnet USDC, so Sisonke won't show it."

Per escrow: `escrow.token === info.token`, or no amount is rendered (§3.6).

### 4.9 API routes (read-only except Friendbot; Hodl's `lib/api.ts` helpers, CORS-open)

| Route | Returns | Cache |
|---|---|---|
| `POST /api/friendbot {address}` | `{ funded, alreadyFunded?, hash }`. Testnet only, `isAccount` validated, fixed upstream URL | none |
| `GET /api/health` | RPC `getHealth` + Horizon root reachability | none |
| `GET /api/info` | `info()` as JSON strings for bigints + `tokenOk` | `use cache`, 30 s |
| `GET /api/escrow/:id` | `{ escrow, deadlinePassed }` | `use cache`, 10 s, tag `escrow-<id>` |

Bigints are serialised as decimal strings. The Setup page uses `/api/friendbot`. No page uses the
other routes for what it displays.

---

## 5. Write path

### 5.1 Pipeline (`lib/stellar/tx.ts`)

`invoke(method, args, { source, sign, onStage, context })`, for one write at a time (TxProvider
refuses a second while `busy`):

1. **Local pre-checks** (no network beyond cached reads, before stage 1). Each produces a §5.3
   error with no simulation: wallet connected; wallet on Testnet (§8.4); source account exists
   ("This wallet has no XLM yet. Get test XLM in setup."); for `fund` / `create_and_fund`: USDC
   trustline present and authorised, balance ≥ amount (board copy: "Not enough USDC / This deposit
   needs 250.00 USDC and your wallet has 120.00. Top up, then try again. Nothing was sent." with fix
   `Get test USDC`; "Your wallet can't hold USDC yet / Add the USDC trustline first. It takes one
   signature. Nothing was sent." with fix `Add the trustline`). For `release` / `refund` / `reclaim`
   / `resolve`, a missing or frozen trustline on the receiving side shows a **warning Notice** in
   the action card before the click ("The recipient's wallet can't receive USDC yet, so a release
   would fail. Ask them to add USDC in Sisonke setup."). It doesn't block: simulation decides.
2. **Stage `checking`:** `server.getAccount(source)`; build with `TransactionBuilder(account, { fee:
   BASE_FEE, networkPassphrase })`, `sisonke.call(method, ...args)`, `setTimeout(180)`;
   `simulateTransaction` (record mode). On `isSimulationError` → map (§5.3) and stop. **The wallet
   never opens for a call the contract would refuse.** Then `assertSourceOnlyAuth(sim.result.auth,
   source)`: every auth entry must have `sorobanCredentialsSourceAccount` credentials. Anything else
   aborts with "Unexpected signature request. Sisonke only ever asks your wallet to sign its own
   transaction." Assemble with `rpc.assembleTransaction(tx, sim).build()`. Keep the fee estimate
   (`BASE_FEE + minResourceFee`, shown in XLM, 7 decimals, from bigint).
3. **Stage `signing`:** `sign(prepared.toXDR())` (kit `signTransaction(xdr, { networkPassphrase,
   address })`). Parse the result with `TransactionBuilder.fromXDR(signedXdr,
   config.networkPassphrase)`, then verify: (a) `signed.hash()` equals `prepared.hash()` (the wallet
   changed nothing); (b) some signature verifies with `Keypair.fromPublicKey(source).verify(
   prepared.hash(), sig.signature())`. If (b) fails: "Your wallet signed for a different network.
   Switch it to Testnet and try again. Nothing was sent." Wallet rejection → §5.3.
4. **Stage `submitting`:** `sendTransaction(signed)`. `PENDING` and `DUPLICATE` → continue. `ERROR`
   → decode `errorResult` (txBadSeq, txInsufficientBalance, txInsufficientFee, txBadAuth, txTooLate)
   and `diagnosticEvents` via `chainError`. `TRY_AGAIN_LATER` → "Stellar is busy. Try again in a
   moment. Nothing was sent."
5. **Stage `confirming`:** `pollTransaction(hash, { attempts: 60 })`. `SUCCESS` → result `{ hash,
   ledger, returnValue (scValToNative), feeCharged (from resultXdr), createdAt }`. `FAILED` →
   `chainError(diagnosticEventsXdr)` → §5.3, **with the hash** (the failure is on-chain and links to
   the explorer). Still `NOT_FOUND` → "Still confirming. Stellar hasn't confirmed <hash> yet. This
   page updates when it does." (keep polling in the background).
6. **After SUCCESS only:** invalidate `["escrow", id]`, `["history", id]`, `["party"]`,
   `["readiness"]`, `["info"]`. Refetch the escrow until `escrow.updatedLedger >= result.ledger` (up
   to 5 tries, 1.5 s apart). **The displayed status changes only through that read.** Nothing is
   optimistic (board: "Status changes only after Stellar confirms the transaction.").

`addTrustline` and `swapXlmForUsdc` run stages 1, 3, 4, 5 (no simulation; "Checking" means
loading the account and quote).

### 5.2 Progress UI (TxProgress, TxResult, TxError)

The action card (or the Create summary) swaps from actions to `TxProgress`, titled with the action
label ("Release to recipient"):

| # | Label | Sub-line | Active while |
|---|---|---|---|
| 1 | Checking with the contract | A free dry run. Nothing is signed yet. | `checking` |
| 2 | Approve in your wallet | <Wallet> shows exactly what you're signing. | `signing` |
| 3 | Sending to Stellar | Usually takes a few seconds. | `submitting` |
| 4 | Confirmed | While confirming: "Waiting for the next ledger." Done: "Status updated. Transaction <short hash>." | `confirming` → done |

Step marks as the board: done = lime circle with ink check (`.pop`), active = violet arc `.spin`,
pending = 20px line-strong ring with faint label. `aria-live="polite"` on the list.

During `signing`, show the board's dark card (ink, radius-tile, `.pop`) as an **honest summary**, not
a fake wallet: "<Wallet> is asking you to sign" / the action label; `dl`: Function (`release`),
Escrow (`#0042`), Contract (short id), From (short wallet address), Network "Stellar Testnet", Fee
"≈ 0.0123 XLM". No Approve/Reject buttons: those live in the wallet.

**TxResult:** `Done` (ink md) + "Open on Stellar Expert" (violet link to `/tx/<hash>`), the full
hash (mono, wraps), "Ledger 5,442,580 · Fee 0.0123 XLM". Focus moves to the result heading.

**TxError** (board error block, `.shake`, `role="alert"`): 52px error-bg circle with "!"; serif
title; body; optional fix link (lime md, internal only, e.g. `/setup`); `Try again` (outline); the
failed transaction's TxHash when there is one.

### 5.3 Error mapping (`lib/sisonke/errors.ts`)

`toSisonkeError(err, context: { method, escrow?, role? }) → { title, body, fix?: { label, href },
code?, hash? }`. Recognition order: our pre-check errors → `Error(Contract, #N)` (N ≥ 100: Sisonke;
N < 100: USDC SAC) → `Error(Auth, …)` → wallet rejection (`code === -4`, or
`/reject|declin|denied|cancel|closed the modal|user refused/i`) → send result codes → transport
(`/fetch|network|timeout|ECONN|Failed to fetch/i`) → fallback "Something went wrong" + first line
(≤ 200 chars, as text). Every body that applies ends with "Nothing moved." or "Nothing was sent."
**Every code in `errors.rs` has an entry** (enforced by `errors-coverage.test.ts`):

| Code | Name | Title | Body (X = amount, D = deadline) |
|---|---|---|---|
| 100 | NotFound | No escrow with that ID | The Sisonke contract on Testnet has nothing with this ID. Check the number, or ask for the full link. |
| 101 | InvalidStatus | Already moved on | Context: `fund` → "This escrow is already funded. It can't be funded twice."; release/refund/reclaim on Created → "Nothing is locked yet, so there's nothing to <verb>."; final status → "This escrow is already <status>. Nothing pays out twice."; reclaim while disputed → "A dispute is open, so only the arbiter can send money back."; default → "The escrow's status doesn't allow that any more. Refresh to see where it is." Always + " Nothing moved." |
| 102 | DeadlinePassed | Too late | `fund`: "The deadline has passed, so the contract won't take a deposit. You can cancel this escrow." `dispute`: "The deadline has passed, so a dispute can't be opened. The payer can now reclaim." |
| 103 | DeadlineNotReached | Not yet | The deadline hasn't passed. The payer can't take the money back before D. |
| 104 | NoArbiter | No arbiter on this escrow | It was created without an arbiter, so there's no dispute. The money moves only by release, refund, or reclaim after the deadline. |
| 105 | NotParty | Not part of this escrow | Only the payer or the recipient can open a dispute. |
| 106 | InvalidSplit | Check the split | The recipient's share must be between 0 and X USDC. |
| 107 | TransferMismatch | The deposit didn't add up | The contract didn't receive exactly X USDC, so it refused the deposit. |
| 120 | InvalidAmount | Check the amount | Enter an amount above zero. |
| 121 | SameParty | That's your own address | You can't pay yourself. Use the recipient's address. |
| 122 | InvalidArbiter | Pick a different arbiter | The arbiter must be someone other than you and the recipient. |
| 123 | InvalidParty | That's the escrow contract | The payer, recipient and arbiter must be wallets, not the Sisonke contract itself. |
| 124 | DeadlineInPast | Deadline already passed | Pick a deadline in the future. |
| 125 | DeadlineTooFar | Deadline too far away | Pick a deadline within 365 days. |
| 126 | TitleTooLong | Note too long | Keep it to 64 bytes. Some characters, like emoji, take up to 4. |
| 127 | BatchTooLarge | Too many at once | The app asked for more than 20 escrows in one read. Refresh to try again. |
| 128 | InvalidTitle | Note has hidden characters | Remove line breaks, tabs and other control characters. |
| 140 | Paused | Paused right now | The contract admin has paused new escrows and deposits. Every way out (release, refund, reclaim, dispute, decide, cancel) still works. |
| 141 | MigrationRequired | Contract update in progress | The contract's code was just upgraded and its data needs a one-time migration. Anyone can run it. Fix: `Run the migration` (invokes `migrate()`, then retries the read). |
| 142 | NothingToMigrate | Already up to date | The migration has already run. Try your action again. |
| 143 | Overflow | Number too large | A counter in the contract would overflow, so it refused. |
| 200 | UpgradesLocked | The code is final | Upgrades are locked for good. (admin only) |
| 201 | NoPendingAdmin | No admin change pending | (admin only) |
| 202 | InvalidUpgradeDelay | Upgrade delay out of range | It must be between 60 seconds and 30 days. (admin only) |
| 203 | NoPendingUpgrade | No upgrade proposed | (admin only) |
| 204 | UpgradeTooEarly | Too early to upgrade | The public notice period hasn't ended. (admin only) |
| 205 | UpgradeDelayDecrease | The notice period can only grow | (admin only) |
| 206 | UpgradeHashMismatch | Different code than proposed | (admin only) |
| 207 | UpgradeExpired | Upgrade proposal expired | It must be proposed again, with a fresh notice period. (admin only) |

USDC SAC codes (W = whose wallet, from context: `fund`/`create_and_fund` "Your", `release` "The
recipient's", `refund`/`reclaim` "The payer's", `resolve` "The payer's or the recipient's"):

| Code | Name | Title | Body |
|---|---|---|---|
| 6 | AccountMissingError | That wallet isn't on Testnet yet | W wallet needs test XLM first. |
| 10 | BalanceError | Not enough USDC | W wallet doesn't hold enough USDC for this. |
| 11 | BalanceDeauthorizedError | USDC is frozen on that wallet | Circle has frozen USDC for W wallet, so it can't send or receive it. |
| 13 | TrustlineMissingError | W wallet can't hold USDC yet | Add the USDC trustline in setup. It takes one signature. (fix `/setup` when it's the user's own) |
| 1–5, 7–9, 12 | (others) | USDC refused the transfer | The USDC contract returned error #N. |

The Coding agent verifies the SAC numbers once against Testnet: the e2e "deposit with no
trustline" step must decode to 13.

Auth (`Error(Auth, InvalidAction)`): "Not yours to sign / The contract only accepts this from the
<payer|recipient|arbiter>." Wallet rejection (board copy): "You rejected it in your wallet / Nothing
was sent and nothing changed. Try again whenever you're ready." Send codes: txBadSeq "Your account
changed since we checked. Try again.", txInsufficientBalance "Not enough XLM for the fee. Get test
XLM in setup.", txTooLate "It expired before it was sent. Try again.", txBadAuth "The signature
didn't match. Is your wallet on Testnet?". Transport: "Couldn't reach Stellar / Check your
connection and try again."

### 5.4 Try anyway (BlockedList)

`probe(method, args, source)`: build the same transaction with **one explicit auth entry** for the
root invocation with source-account credentials (port `sourceAuth()` from `scripts/e2e.ts`), and
call `simulateTransaction(tx, undefined, "enforce")`. Decode the error with §5.3 and show the
board's toast (error-bg, `.shake`, `role="alert"`): "Rejected by the contract" / <body> + " No
money moved." / Dismiss. The footnote under the list says: "Try anyway asks the contract on
Testnet. Nothing is signed or sent."
- If the probe **succeeds** (the view was stale), show a sand Notice: "The contract would accept this
  right now. Refreshing…" and refetch. Never submit from a probe.
- If the RPC rejects `authMode`, fall back to record mode. For a wrong signer (which record mode
  can't catch), show the matrix reason labelled "The contract checks the signature when a
  transaction is sent: only the <role> can do this."

---

## 6. Role-aware escrow page

### 6.1 Role

`roleOf(escrow, address)`: no wallet → `guest`; `payer`; `recipient`; `arbiter`; otherwise
`stranger`. The contract guarantees these never overlap. The admin has no role.

### 6.2 Action matrix (`lib/sisonke/actions.ts`)

```ts
type ActionId = "fund" | "cancel" | "release" | "refund" | "reclaim" | "dispute" | "resolve";
interface Ctx { status: Status; role: Role; deadlinePassed: boolean; hasArbiter: boolean;
  disputeWindowOpen: boolean /* ledgerNow < deadline - 600 */; paused: boolean }
function actionsFor(ctx: Ctx): { allowed: ActionId[]; blocked: { id: ActionId; why: string }[] }
```

Allowed (CONTRACT.md "Who may do what"):

| Status, time | Payer | Recipient | Arbiter | Stranger | Guest |
|---|---|---|---|---|---|
| Created, before deadline, not paused | **fund**, cancel | none | none | none | Connect card |
| Created, before deadline, paused | cancel | none | none | none | Connect card |
| Created, deadline passed | cancel | none | none | none | Connect card |
| Funded, before deadline | **release**, dispute† | **refund**, dispute† | none | none | Connect card |
| Funded, deadline passed | **release**, **reclaim** | **refund** | none | none | Connect card |
| Disputed (any time) | **release** | **refund** | **resolve** | none | Connect card |
| Released / Refunded / Split / Cancelled | none | none | none | none | Connect card |

† only when `hasArbiter && disputeWindowOpen`. **Bold** = primary (lime) button; the rest are
`outline`. Order in the card: primary first. With the wallet on the wrong network, allowed actions
render disabled with the note "Switch your wallet to Testnet to sign."

**Blocked list ("Not yours to do", non-guests only):** candidates are `fund`, `release`, `refund`,
`reclaim` always (as the board), plus `dispute` and `resolve` when `hasArbiter`, plus `cancel` when
`Created`. Each candidate that is not allowed shows its label and the first matching reason:
1. Final status: "This escrow is closed."
2. Wrong signer: stranger "You're not part of this escrow."; otherwise "Only the payer can do
   this." / "Only the recipient can do this." / "Only the arbiter can do this." / dispute: "Only the
   payer or the recipient can do this."
3. Status: fund when Funded/Disputed "Already deposited."; release/refund/reclaim when Created
   "Deposit first. Nothing is locked yet."; reclaim when Disputed "A dispute is open, so the arbiter
   decides."; dispute when Created "Nothing is locked yet."; dispute when Disputed "A dispute is
   already open."; resolve when not Disputed "Only after someone opens a dispute."
4. Time: fund after the deadline "The deadline has passed."; reclaim before it "Opens on <D> if
   still locked."; dispute inside the cutoff "Disputes close 10 minutes before the deadline, so one
   can't land too late."
5. Pause: fund "Deposits are paused right now."

Each blocked row has the dashed `Try anyway` button (§5.4).

### 6.3 Labels and descriptions (`copy.ts`)

| Action | Button label | Description under the button |
|---|---|---|
| fund | Deposit X USDC | Moves the USDC from your wallet into the contract. The recipient can then see it's locked. |
| cancel | Cancel escrow | Closes it for good. Nothing was deposited, so nothing moves. |
| release | Release to recipient | Sends all X USDC to the recipient. This can't be undone. (Disputed: "Ends the dispute and sends all X USDC to the recipient. This can't be undone.") |
| refund | Refund to payer | Sends all X USDC back to the payer. This can't be undone. (Disputed: "Ends the dispute and sends all X USDC back to the payer.") |
| reclaim | Reclaim X USDC | The deadline has passed. Sends all X USDC back to you. This can't be undone. |
| dispute | Open a dispute | Hands the decision to the arbiter <short>. Nothing moves now. After this the payer can't reclaim, and the arbiter decides how to split it. |
| resolve | Confirm decision | (ResolveForm, §6.6) |

Blocked-list labels: "Deposit", "Release", "Refund", "Reclaim after the deadline", "Open a
dispute", "Decide the dispute", "Cancel".

### 6.4 Headings and intros (action card)

| Role | Status | Heading | Intro |
|---|---|---|---|
| payer | Created | Your move | Deposit the USDC so the recipient can see it's locked before they start. (+ the upgrade-delay note from §3.5 when it applies, as a sand Notice) |
| payer | Created, past deadline | Too late to deposit | The deadline passed before this was funded, so the contract won't take a deposit. Cancel it to close it. |
| payer | Funded | Your move | Release the money once you're happy with the work. (past deadline: "The deadline has passed. Release it if the work arrived, or take it back.") |
| payer | Disputed | In dispute | The arbiter <short> decides how to split it. You can still release it all to the recipient. |
| recipient | Created | Waiting on the payer | Nothing is locked yet. Don't start work until the status says Funded. |
| recipient | Funded | Your move | It's locked. Safe to start work. If the deal falls through, send the money back to the payer. Don't recognise this escrow? Refund it. (past deadline adds "The deadline has passed, so the payer can now take it back.") |
| recipient | Disputed | In dispute | The arbiter decides how to split it. You can still refund it all to the payer. |
| arbiter | Created, Funded | Nothing for you yet | As the arbiter you can act only if the payer or the recipient opens a dispute. |
| arbiter | Disputed | Your decision | Divide the X USDC between the payer and the recipient. It's final. |
| stranger | any open | Just looking | Only the payer and the recipient<, and the arbiter in a dispute,> can act on this escrow. The contract rejects anyone else's signature. |
| any non-guest | final | Nothing left to do | This escrow is closed. The contract won't accept another release or refund. (+ `Start another escrow` outline → `/new`) |
| guest | any | Connect to act | Board copy ("View only" chip, `Connect wallet` primary, "New to Stellar? Set up in four steps"). |

### 6.5 Status presentation (`status.ts`)

| Status | Coin (`left`) | Highlighted cell | Contract holds | Caption | Sentence |
|---|---|---|---|---|---|
| Created | 16.66% | payer (ground) | 0.00 | Nothing locked yet | Waiting for the payer to deposit X USDC. Nothing is locked yet. ("…for you to deposit…" for the payer) |
| Funded | 50% | contract (lime) | X | Locked until released or refunded | X USDC is locked in the contract. It moves only when the payer releases it or the recipient refunds it<, or the arbiter decides a dispute>. (past deadline: + "The deadline has passed, so the payer can also take it back.") |
| Disputed | 50% | contract (lilac) | X | In dispute | X USDC is locked and in dispute. The arbiter decides how to split it. The payer can still release it, or the recipient can still refund it. |
| Released | 83.33% | recipient (ground) | 0.00 | Paid out to the recipient | X USDC was paid to the recipient<, by the arbiter's decision>. This escrow is closed for good. |
| Refunded | 16.66% | payer (ground) | 0.00 | Returned to the payer | X USDC went back to the payer. <The recipient refunded it. / The payer reclaimed it after the deadline. / The arbiter decided it.> (from `closed_by`) This escrow is closed for good. |
| Split | 50%, coin at .35 opacity | payer and recipient (ground) | 0.00 | Split by the arbiter | The arbiter divided it: P USDC to the recipient, Q USDC to the payer. Closed for good. (`paid_to_*`) |
| Cancelled | 16.66% | none | 0.00 | Nothing ever locked | The payer cancelled it before depositing. No money ever moved. |

The money strip's party cells show the role label, the short address (mono), and the black "You"
badge on the viewer's cell. **No invented names.** Created amounts are never shown as owed, incoming
or locked: the cell says 0.00 and "Nothing locked yet" (INTEGRATION §3).

ProgressSteps: `[Created, Funded, "Released or refunded"]`. The third label becomes the final status
name. Disputed renders step 2 as "In dispute" with a violet mark. Cancelled renders `[Created,
Cancelled]` and hides the third step. Footnote: "Status changes only after Stellar confirms the
transaction."

### 6.6 Parties and the arbiter warning (PartiesCard, ResolveForm)

- Three rows: Payer, Recipient, Arbiter. Each has the full address (mono, `break-all`), Copy,
  Explorer, and the "You" badge.
- **No arbiter:** "No arbiter: no dispute is possible. The money moves only by the payer's release,
  the recipient's refund, or the payer's reclaim after the deadline."
- **With an arbiter**, everyone sees: "Chosen by the payer. They can split the money if either of
  you opens a dispute before the deadline." plus its history. `arbiterStats(arbiter)`: count =
  `party_escrow_count(arbiter, Arbiter)`; read the newest ≤ 40 ids, `get_escrows`; among those with
  `closed_by == arbiter`: n to the recipient (Released), n to the payer (Refunded), n split. Copy:
  "Arbiter on N funded escrows. Decided M disputes: a for the recipient, b for the payer, c split."
  (or "No decisions yet.").
- **Recipient view, open escrow with an arbiter:** the same block becomes a sand Notice with the
  triangle, placed in the action card above the actions: "The payer picked this arbiter. If you
  don't know and trust them, don't start work: they can decide a dispute for the payer. You can
  refund to step out." (INTEGRATION §6, CONTRACT.md rule 5).
- **ResolveForm** (arbiter, Disputed): AmountInput "To the recipient" (`parseAmount`, `0 ≤ r ≤
  amount`); Segmented quick picks `All to recipient` (r = amount), `Half each` (r = amount / 2n,
  floor; the odd stroop goes to the payer), `All to payer` (r = 0n); a live line "The recipient gets
  P USDC. The payer gets Q USDC. Result: Released / Refunded / Split."; a Notice when a receiving
  side lacks a trustline; `Confirm decision` (primary). Calls `resolve(id, recipient_amount)`.

### 6.7 Contract notices (`ContractNotices.tsx`, `notices.ts`), on every page

Order under the header: Misconfigured (replaces content) → WrongNetworkBanner → UpgradeBanner →
PausedBanner. Each sits inside the 1240px container, `mt-3`, `.slidein`.

**UpgradeBanner**: non-dismissable. Ink card, radius-tile, on-ink text, lime icon tile, countdown in
Anton lime. Computed by `upgradeNotice(info, ledgerNow)` → `none | beforeEta | live | expired`:
- `beforeEta`: "An upgrade of this contract has been proposed (code `<hash short>`, Copy) and can
  take effect from **<eta, local time>** (in 52m 10s). If you don't trust it, settle your escrows
  before then. As a payer before your deadline you can release to the recipient, or ask them to
  refund you. As a recipient you can refund the payer. In a dispute, ask the arbiter to decide.
  After an escrow's deadline, the payer can reclaim."
- `live` (eta ≤ now ≤ expires_at): "This upgrade **can take effect at any moment until
  <expires_at>**." + the same guidance.
- `expired`: a sand card: "The proposed upgrade expired and can't run. A new proposal would start
  a new notice period."
- **Code-published check:** `getLedgerEntries(contractCode(hash))`. When it is missing, add an
  error-bg strip: "The proposed code isn't published yet, so nobody can review it. Treat this
  proposal as hostile." Always link "How to check this code" → the repo's
  `docs/UPGRADES.md#shipping-a-v2` (step 6), when `NEXT_PUBLIC_REPO_URL` is set.
- **On the escrow page**, for open escrows, add a line: "What you can do alone, right now:" from
  `aloneNow(role, status, deadlinePassed)`: payer Funded before the deadline "Release to the
  recipient. To get your money back before <D>, ask the recipient to refund."; payer Funded after
  the deadline "Reclaim it."; payer Disputed "Release to the recipient, or ask the arbiter to
  decide."; payer Created "Nothing is locked. You can cancel."; recipient Funded/Disputed "Refund
  the payer."; arbiter Disputed "Decide the dispute."; otherwise nothing. Then "Ask the other side
  to settle with you."
- The dashboard puts a small violet dot on every open row while a proposal is pending.

**PausedBanner** (`info.paused`): sand card, "New escrows and deposits are paused by the contract
admin. Every way out still works." Create and Deposit are disabled with that reason.

**WrongNetworkBanner** (wallet passphrase ≠ config): error-bg, "Your wallet is on <Public network |
another network>. Switch it to Testnet to sign. You can still look around." Writes are blocked.

**Migration (141):** any read or write that hits 141 shows a sand card: "A contract migration is
pending. Writes are paused until someone runs it. Anyone can." + `Run the migration` (needs a
wallet).

`app/(dev)/dev/notices/page.tsx` renders every notice state from fixed props for review and
screenshots. It calls `notFound()` when `process.env.NODE_ENV === "production"`.

### 6.8 Titles

Display path (`displayTitle(raw)`): strip U+202A–U+202E, U+2066–U+2069, U+200B–U+200D, U+200E,
U+200F, U+FEFF. If anything was stripped, show a muted "(hidden characters removed)" after it.
Render as a React text node, never as `innerHTML`, markdown, a link or a button label. On the escrow
page it is a quote in Instrument Serif 26px ("“Logo for the café”") followed by muted 13px "Note from
the payer", clamped to 2 lines with the full text in `title`. In rows: one line with ellipsis. Empty
→ "Untitled escrow" (muted). The title never sets status, colour or a chip.

---

## 7. Wallet setup (`/setup`)

WalletProvider is Hodl's, plus: `walletName` (from the selected module), a `setWallet(id)` +
`fetchAddress()` connect path for **our own ConnectModal** (the design's modal replaces the kit's
`authModal`), `StellarWalletsKit.refreshSupportedWallets()` for availability, and `onTestnet` from
`getNetwork()` (null when the wallet can't say). Modules, in this order: Freighter, xBull, Lobstr,
Albedo, Hana (`network: Networks.TESTNET`). Wallet buttons use the board's initial tiles (ink tile,
lime Anton initial), not remote icons. An unavailable wallet shows "Not installed" and an external
link to its `url`.

| Step | Done when (live from Horizon/wallet) | Action | Busy label | Done copy |
|---|---|---|---|---|
| 1 Connect a wallet | wallet connected **and** `onTestnet !== false` | WalletPicker | "Waiting for <Wallet>…" | "Connected with **<Wallet>**", short address, `Switch wallet` |
| 2 Get test XLM | account exists and XLM ≥ 2 | `Get test XLM` → `POST /api/friendbot`, then poll readiness (5 s) until it exists | "Asking Friendbot…" | after Friendbot: "**10,000 test XLM** added. Plenty for fees." Already funded: "Your wallet has **N test XLM**. Plenty for fees." |
| 3 Add a USDC trustline | USDC balance line exists and is authorised | `Add trustline` → changeTrust via the pipeline | "Approve in your wallet…" (then "Sending to Stellar…") | "**USDC trustline** added to your wallet." |
| 4 Get test USDC | USDC balance > 0 | `Open Circle's faucet` (external, https://faucet.circle.com) + `Copy my address`; `Swap XLM for 10 USDC` (path payment); `I've got my USDC` (refetch) | "Swapping on the Testnet DEX…" | "**Test USDC** is in your wallet." |

- Locked steps show the board's locked style and labels ("Connect a wallet first", "Get XLM first").
  Status pills: "Up next", "Waiting on the step above", "Working…", "Done".
- **Network check (step 1):** `onTestnet === false` → step 1 is not done: "Your wallet is on another
  network. Switch it to Testnet, then reconnect." `null` → done, with the muted note "Your wallet
  doesn't tell apps its network. Make sure it's set to Testnet." (the signature check in §5.1 still
  guards).
- **DEX swap:** port `topUpUsdc` from `scripts/e2e.ts`: `strictReceivePaths([native], USDC,
  "10.0000000")`, take the cheapest native path, refuse when the quote is above 100 XLM, `sendMax =
  min(quote × 3, 100)` (7-decimal string built from the quote string, no float maths on balances),
  and the `path` assets from the record. Show "About <quote> XLM, at most <sendMax> XLM." before
  signing. No path → "The Testnet DEX has no XLM → USDC offers right now. Use Circle's faucet."
- `I've got my USDC` refetches. Still 0 → "No USDC yet. Circle's faucet can take a minute."
- Progress and the ready banner follow §3.2.

---

## 8. Security requirements

### 8.1 Rendering and code rules (also in `web/AGENTS.md`)

- **Never** `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval`, `new Function`, or string `setTimeout`. ESLint: `react/no-danger:
  error`, plus `no-restricted-syntax` / `no-restricted-properties` for the rest. `no-raw-html.test.ts`
  scans `app/`, `components/`, `lib/` for these tokens.
- All chain strings (titles, addresses, hashes, event data) render as React text. Titles follow
  §6.8.
- `href`s are built only from `config` plus validated values (`explorer.*` validates). No `href`,
  `src` or redirect ever takes user or chain text. External links get `target="_blank" rel="noopener
  noreferrer"`.
- `document.title` and metadata never include escrow titles.
- `localStorage` holds only the kit's session and hidden ids. Nothing read from it decides status,
  amounts or permissions. Every access is wrapped in try/catch.
- Clipboard writes carry only the app's own strings (link, address, contract id, hash).

### 8.2 Headers (`next.config.ts` `headers()`, all routes)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline'<dev only: 'unsafe-eval'>;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' <NEXT_PUBLIC_RPC_URL origin> <NEXT_PUBLIC_HORIZON_URL origin>;
  frame-src 'none'; frame-ancestors 'none'; object-src 'none';
  base-uri 'self'; form-action 'self'; upgrade-insecure-requests
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin-allow-popups   (Albedo signs in a popup)
```

Build the CSP string from `config` at build time. If a wallet module needs another origin (seen as
a CSP violation in the console, which fails the e2e), add exactly that origin with a comment naming
the wallet. Never add wildcards.

### 8.3 Input validation (pure functions in `lib/sisonke`, unit-tested)

- **Addresses** (`address.ts`): accept only `StrKey.isValidEd25519PublicKey` (G…, 56 characters)
  after trimming. Messages: invalid → "That doesn't look like a Stellar address. It starts with G
  and is 56 characters long."; a secret seed (`isValidEd25519SecretSeed`) → **clear the field** and
  show "That's a secret key. Never paste it anywhere. Sisonke only needs an address that starts with
  G."; muxed `M…` → "Use the plain G… address, not a muxed M… one."; contract `C…` → "Use a wallet
  address (G…), not a contract."; recipient = own address → "That's your own address. You can't pay
  yourself."; arbiter = payer or recipient → "The arbiter must be someone other than you and the
  recipient."; any party = the Sisonke contract → 123's copy.
- **Amounts** (`amount.ts`), with no `Number`, `parseFloat` or float maths anywhere on money:
  `parseAmount(text): { ok: true; stroops: bigint } | { ok: false; error }`. Trim; then
  `^(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d*))?$` with at least one digit somewhere. Commas only as
  thousands separators (`1,234.5`). `1,5` → "Use a dot for decimals, like 1.50." More than 7
  decimals → "USDC has at most 7 decimal places." (never rounds). Reject signs, exponents, spaces
  inside, non-ASCII digits. `stroops = whole × 10^7 + frac.padEnd(7, "0")`. `0` → "Enter an amount
  above zero." Above `9_223_372_036_854_775_807n` (i64 max, the most a Stellar balance can hold) →
  "That's more than any wallet can hold." `formatUsdc(stroops, { min = 2 })` groups thousands
  manually with "," (no locale), keeps every significant decimal up to 7, at least 2 (`1n` →
  "0.0000001", `6_000_000n` → "0.60", `12_345_000_000_000n` → "1,234,500.00"), and never rounds.
  Horizon balance strings go through `parseAmount`.
- **Title** (`title.ts`): `new TextEncoder().encode(t).length ≤ 64` ("Keep it to 64 bytes. Emoji
  count as up to 4."); reject U+0000–U+001F and U+007F ("Remove line breaks and tabs."); reject the
  §6.8 bidi and zero-width characters at input ("Remove hidden formatting characters."). No
  trimming inside, trim ends. Empty is allowed.
- **Deadline** (`deadline.ts`): presets = `floor(ledgerNow) + days × 86_400`. Custom =
  `floor(Date.parse(local) / 1000)` and must satisfy `ledgerNow + 120 ≤ d ≤ ledgerNow + 365 × 86_400
  − 300` ("Pick a time at least 2 minutes from now." / "Pick a deadline within 365 days."). The
  margins keep simulation and submission inside the contract's bounds.
- **Escrow id**: `^\d{1,15}$`, ≥ 1 (Hodl `parseId`), for routes, API and Find.
- **Contract and token ids** come only from config, never from URLs or input (INTEGRATION §1).

### 8.4 Network and signing guards

- Startup checks (§4.8).
- The wallet's network (`onTestnet === false`) blocks every write before the checking stage.
- `signTransaction` always passes `networkPassphrase` and `address`.
- The returned envelope must hash-equal the prepared one, and carry a valid signature by the source
  for that hash (§5.1 step 3). Otherwise nothing is sent.
- Auth entries must be source-account only (§5.1 step 2).
- The source must equal the connected address. `dispute`'s `by` and `create`'s `payer` are always
  the connected address, never typed.

### 8.5 Secrets and dependencies

- No secrets in the web app at all. Every env var is `NEXT_PUBLIC_*` and public, from
  `deployments/testnet.env`. The API routes hold no keys.
- The e2e secret keys (`scripts/.env`, gitignored) stay in the Node process. The page only gets
  `__e2eAddress` / `__e2eSign` bindings (Hodl's stand-in pattern).
- Pin every dependency exactly. Keep Hodl's `pnpm-workspace.yaml` `allowBuilds` deny-list. No
  analytics or third-party scripts.
- `/api/friendbot` is Testnet only, validates the address, calls only `config.friendbotUrl`, and
  never forwards other input.

---

## 9. Test plan

### 9.1 Static checks

`pnpm typecheck` (`tsc --noEmit`, strict), `pnpm lint` (eslint with §8.1 rules, zero warnings),
`pnpm build`.

### 9.2 Unit tests (Vitest, `pnpm test`)

| File | Covers |
|---|---|
| `lib/sisonke/amount.test.ts` | Valid/invalid parse table (`"250"`, `"250.5"`, `".5"`, `"12."`, `"1,234.56"`, `"0.0000001"`, `"1,5"`, `"1.23456789"`, `"-1"`, `"1e3"`, `"1 000"`, `"١٢"`, `"0"`, i64 max and max+1); format table; round trip for 1,000 pseudo-random bigints (fixed seed); never rounds; no float code (scan the module for `parseFloat`/`Number(`). |
| `lib/sisonke/actions.test.ts` | The full product role(5) × status(7) × deadlinePassed × hasArbiter × disputeWindowOpen × paused. Explicit assertions for every ✔ cell of CONTRACT.md "Who may do what", and that stranger, guest and the admin never get an action, the arbiter only `resolve` while Disputed, nobody gets `reclaim` while Disputed, and every blocked candidate has a reason. |
| `lib/sisonke/errors.test.ts` | Decoding sim strings `Error(Contract, #101)`, `Error(Auth, InvalidAction)`, SAC `#13` with each method context, 101 context variants, wallet rejections (`{code:-4}`, "User declined access"), send codes, transport, fallback. |
| `tests/errors-coverage.test.ts` | Parses `../contracts/sisonke-escrow/src/errors.rs` (`Name = N,`) and asserts `errors.ts` has the same code → name set, each with a title and body. |
| `tests/contract-spec.test.ts` | Extracts the base64 spec entries (`"AAAA…"`) from `web/contract/src/client.ts`, builds `new contract.Spec(entries)`, and for every write and read in §4.2 asserts `encoder(args)` XDR equals `spec.funcArgsToScVals(name, args)` XDR (including Option None/Some, PartyRole, Vec<u64>). Decodes a sample `EscrowView` built with `spec.nativeToScVal` through `decode.ts`. |
| `lib/sisonke/title.test.ts` | Byte limit at 64/65 with multibyte text, control characters, bidi/zero-width rejection at input and stripping on display. |
| `lib/sisonke/address.test.ts` | G valid; S cleared with warning; M, C, garbage; own address; arbiter collisions. |
| `lib/sisonke/deadline.test.ts` | Presets from a fixed ledgerNow; custom bounds; dispute window at deadline − 601 / − 600. |
| `lib/sisonke/status.test.ts` | Label, chip variant, coin position, caption and sentence for all 7 statuses; Refunded wording by `closed_by`; Split amounts; Created never shows the amount as locked. |
| `lib/sisonke/notices.test.ts` | `upgradeNotice` none / beforeEta / at eta / live / at expires_at / expired; `aloneNow` per role × status × deadline. |
| `lib/sisonke/spam.test.ts` | Each rule; "interacted" (signed) overrides; payer tab never filtered. |
| `lib/stellar/tx.test.ts` | `assertSourceOnlyAuth` accepts source credentials and rejects address credentials; signature verification helper rejects a wrong-network signature (sign with a Keypair under another passphrase). |
| `tests/config.test.ts` | Generated deployment equals `../deployments/testnet.env`; `Asset("USDC", issuer).contractId(passphrase) === usdcSacId`; `explorer.*` rejects bad input. |
| `tests/no-raw-html.test.ts` | §8.1 scan. |

### 9.3 Real-Testnet e2e (`e2e/app.e2e.mjs`, `pnpm e2e`)

Port Hodl's script: system Chrome (`CHROME_PATH`), the Freighter stand-in (it also answers
`REQUEST_NETWORK_DETAILS`, switchable to PUBLIC for one step), contexts for **payer, recipient,
arbiter, stranger** (fresh keypairs), the funder from `scripts/.env` (`E2E_PAYER_SECRET`, or
`E2E_FUNDER_SECRET`), step reporting, console-error and non-2xx collection (any console error,
including CSP violations, fails the run), and USDC returned to the funder at the end. Every
transaction hash the app shows is collected into `e2e/.out/run.json` (`{ step, escrowId, method,
hash, ok }`) with escrow ids for the screens script. Steps:

1. Landing renders; `Open app` → `/setup`.
2. Payer, recipient and arbiter onboard through `/setup` (connect, Friendbot via the API,
   trustline). The arbiter skips the trustline. Payer step 4: try `Swap XLM for 10 USDC`; if the DEX
   has no path, the funder pays 6 USDC (stands in for Circle). Progress reaches 4/4 for the payer.
3. `/new` validation: bad address, own address, `S…` secret is cleared, `1,5`, 8 decimals, a title
   over 64 bytes (emoji), arbiter = recipient. The wallet signs nothing (`signed === 0`).
4. Wallet rejection on Create → "You rejected it in your wallet", stays on `/new`, nothing created.
5. Wrong network: the stand-in reports PUBLIC → WrongNetworkBanner, Create disabled, nothing signed.
6. **Two-step release:** `create` (1 USDC) → done card with a real id + TxHash → escrow page shows
   "Awaiting deposit — not funded", 0.00 locked. The recipient opens the link: "Waiting on the
   payer". The payer deposits → 4 stages seen in order → Funded. The recipient sees Funded by
   polling. The stranger connects: "Just looking", no action buttons; `Try anyway` on Release →
   toast "Rejected by the contract" with the auth copy; the wallet signed nothing. The payer
   releases → Released; the recipient's USDC grew by exactly 1; Activity lists created, funded,
   released, each with a Stellar Expert link whose hash matches `run.json`.
7. **Duplicate guard:** after Released, the payer's `Try anyway` on Release → the 101 copy
   ("already released. Nothing pays out twice.").
8. **One-signature refund:** `create_and_fund` (toggle on) → Funded; the recipient refunds →
   Refunded, "The recipient refunded it."
9. **Dispute and split:** `create_and_fund` with the arbiter and a custom deadline about 15 minutes
   out. The recipient sees the arbiter warning Notice. The recipient opens a dispute → In dispute.
   The payer's blocked list shows Reclaim "A dispute is open…". The arbiter resolves 0.6 / 0.4 →
   Split, with the payer and recipient balances exact.
10. **Deadline reclaim:** create and deposit with a deadline about 3 minutes out. Reclaim is blocked
    ("Opens on…"); `Try anyway` → 103 copy. Wait for `deadline_passed` (the page flips on its own)
    → reclaim → Refunded, "The payer reclaimed it after the deadline."
11. **Cancel:** `create` → Cancel → Cancelled, "No money ever moved."
12. **Deposit without a trustline:** a fresh wallet with XLM only creates an escrow and deposits →
    the pre-check error "Your wallet can't hold USDC yet" with no signature. The e2e process itself
    (Node, not the page) then simulates that `fund` with the SDK and asserts
    `Error(Contract, #13)`, which confirms the SAC rows of §5.3. No test-only flags in the app.
13. **Spam:** the funder sends the stranger 0.0000001 USDC plus a trustline. The stranger
    `create_and_fund`s 1 stroop to the recipient with a 2-minute deadline and reclaims it. The
    recipient's dashboard shows it collapsed under "1 hidden…", and `Show them` reveals it.
14. `/find`: found (id from step 6), not found (`escrow_count + 50`), invalid (`abc`), and the link
    form `http://localhost:3000/escrow/<id>`.
15. Dashboard: tab counts (paying, receiving, arbiter), filters, stats, rows link to their escrow.
16. Mobile (390×844): create + deposit + release from a phone context. No horizontal scroll on any
    app page (`scrollWidth <= innerWidth`).
17. Disconnect → Connect prompts return.

### 9.4 Screenshots and video (`e2e/screens.e2e.mjs`, `pnpm screens`)

Reads `e2e/.out/run.json`, then visits each URL at **desktop 1440×1000** and **phone 390×844
(DPR 2)** and saves full-page PNGs to `e2e/shots/<desktop|phone>/<nn>-<name>.png`: landing, rules,
setup (fresh and 4/4), dashboard (disconnected, paying, receiving with hidden spam, arbiter), find
(found, not found, invalid), new (empty, filled with summary, working at the signing stage, done),
escrow as guest/payer/recipient/arbiter/stranger for each of Awaiting deposit, Funded, In dispute,
Released, Refunded, Split, Cancelled, plus the refusal toast and the confirmed-transaction state,
and `/dev/notices` (dev server only). Each shot waits for network idle and `document.fonts.ready`,
and asserts no console errors and no horizontal scroll. With `E2E_VIDEO=1`, both scripts record
Playwright video to `e2e/videos/` (one file per context) for the walkthrough recording. All three
output folders are gitignored. README says how to copy the chosen ones into `docs/`.

### 9.5 Definition of done

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass; `pnpm e2e` passes against Testnet
with zero console errors; `pnpm screens` produces every shot above; every brief requirement in the
table below is visible in a screenshot.

| Brief requirement | Where |
|---|---|
| Connect a non-custodial wallet | ConnectModal, `/setup` step 1, header |
| Create (recipient, USDC amount, deadline, optional arbiter, title) | `/new` |
| View id, payer, recipient, amount, status | `/escrow/[id]` header, money strip, parties, details; `/find` |
| Deposit USDC | escrow page `fund` (or `create_and_fund`) |
| View status of an existing escrow | `/find`, `/escrow/[id]`, `/dashboard` |
| Release / refund / dispute / resolve / reclaim / cancel | §6 matrix |
| Contract address and transaction details | details card, footer, TxResult, activity, rules proof |
| Explorer link for every transaction | TxResult, activity rows, Create done, rules proof, landing proof |
| Awaiting deposit / funded / released / refunded (+ disputed, split, cancelled) | StatusChip + money strip + sentences |

---

## 10. Build, run, environment, README

### 10.1 `package.json` scripts

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint --max-warnings 0",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "check": "pnpm typecheck && pnpm lint && pnpm test && pnpm build",
  "sync": "node scripts/sync-deployment.mjs",
  "bindings": "cd .. && OUT_DIR=web/contract scripts/bindings.sh",
  "e2e": "node e2e/app.e2e.mjs",
  "screens": "node e2e/screens.e2e.mjs"
}
```

`packageManager: "pnpm@12.8.1"`. Node ≥ 22.18 (as `scripts/`).

### 10.2 Environment (`.env.example`; all public, defaults from `lib/generated/deployment.ts`)

```
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_EXPLORER_URL=https://stellar.expert/explorer/testnet
NEXT_PUBLIC_SISONKE_CONTRACT_ID=CB65NNEWX53VH7GFZYCIAKIUZIRTS645YVWXSUZCC2VCFB6NFOX7K7MG
NEXT_PUBLIC_USDC_SAC_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
NEXT_PUBLIC_USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
NEXT_PUBLIC_SISONKE_DEPLOY_LEDGER=5442570
# Optional
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_REPO_URL=
```

E2E only (not the app): `BASE_URL` (default `http://localhost:3000`), `CHROME_PATH`,
`E2E_FUNDER_SECRET` (default: `E2E_PAYER_SECRET` from `../scripts/.env`), `E2E_VIDEO`.

### 10.3 Run

```bash
cd web
pnpm install
pnpm sync          # only after scripts/deploy.sh or scripts/e2e.ts changed deployments/
pnpm dev           # http://localhost:3000
pnpm check         # typecheck, lint, unit tests, build
pnpm e2e           # needs scripts/.env with a funded E2E_PAYER_SECRET and Chrome
pnpm screens       # after pnpm e2e
```

### 10.4 README outline (`web/README.md`)

1. What it is (one paragraph, Hodl's tone): Next 16 + Tailwind 4 + motion; reads the chain from the
   browser; wallets via Stellar Wallets Kit; no keys, no database.
2. Quick start (§10.3). Works with no `.env`.
3. Routes table (§3) and API table (§4.9).
4. How a transaction runs: the 4 stages, simulation before the wallet, the checks on the signed
   envelope, status only after confirmation.
5. What the app enforces from INTEGRATION.md (a checklist: pinned token, "Awaiting deposit — not
   funded", title as text, arbiter warning, upgrade banner, spam collapse, deadline from the chain).
6. Layout of `lib/` and `components/` (§1).
7. Testing: unit, e2e, screenshots and video, where the outputs go.
8. Security notes (§8, short) and the CSP trade-off.
9. Photos: the five files to drop into `public/images/`, their Unsplash credits (Vitaly Gariev,
   Iwaria, Joyce Busola, Tunde Buremo), and the alt texts to restore.
10. Regenerating bindings and deployment data (`pnpm bindings`, `pnpm sync`).

---

## 11. Design deviations and copy corrections

The design is binding except for these. Each one exists because the board's copy or behaviour
would be untrue for this contract or would break a rule in INTEGRATION.md.

| Where | Board says / does | Build instead | Why |
|---|---|---|---|
| Landing hero lead (and phone) | "…Nobody else can touch it, including us." | "Sisonke holds the money in a smart contract until the job is done. The payer releases it. The recipient can send it back. This website never holds your keys or your money." | An arbiter can split a disputed escrow, and the admin can upgrade the code after a notice period. |
| FAQ "Does Sisonke ever hold my money?" | "…no admin function can move or freeze it." | "No. Your USDC sits in the escrow contract on Stellar, and this website has no keys. The contract's admin can't move, freeze or redirect an escrow. It can upgrade the code only after a public notice period (<1 hour>), and this site shows a warning on every page while one is pending." | Upgradeability (CONTRACT.md trust assumption 1). |
| FAQ "Who can release or refund?" | payer/recipient only | + "If the payer named an arbiter, the arbiter can split the money, but only after one of you opens a dispute." | Arbiter path. |
| FAQ "What if the other person disappears?" | reclaim after deadline | + "…unless a dispute was opened before it. Then the arbiter decides." | Rule 3. |
| Landing + Rules tables | 4 or 6 rows | Rows from §3.7 (Cancel, Dispute, Resolve added; Release/Refund "Funded or in dispute") | Complete signer table. |
| Rules "No back door" | "No admin function can move, freeze or redirect money in an escrow." | Keep that sentence, then: "The code can be upgraded only after a public notice period of <1 hour>, and every page warns you while an upgrade is pending, so you can settle first." Then keep the rest. | Upgradeability. |
| Rules "Why the payer can reclaim" | "…after the deadline both people saw at the start." | + "…if no dispute was opened before it." | Rule 5. |
| Rules status track | Awaiting deposit → Funded → Released or Refunded | + the muted arbiter/cancel line (§3.7) | Seven statuses. |
| Rules proof | 3 cards with placeholders | One card per scenario in `proof.json` (A–G), real hashes | Real evidence. |
| Escrow chip "Awaiting deposit" | "Awaiting deposit" | "Awaiting deposit — not funded" | INTEGRATION §3 must. |
| Escrow "Try anyway" footnote | "…sends it on Testnet…" | "Try anyway asks the contract on Testnet. Nothing is signed or sent." | It only simulates (§5.4). |
| Escrow dark sign card | Fake wallet with Approve/Reject | Honest "waiting for your wallet" summary (§5.2) | The real wallet shows its own prompt. |
| Escrow tx steps | 3 steps | 4 steps (Checking added first) | Brief; simulation runs before the wallet opens. |
| Wallet menu | Role switcher and wallet scenarios | Address, explorer, network, balances, switch, disconnect | Prototype-only controls. |
| Names in app pages (Megan, Kemi…) | Mock names | Role labels + short addresses + "You" | The contract only knows addresses. |
| Create "What's it for?" | `maxlength="80"` | 64-byte check with counter | Contract error 126. |
| Create | No arbiter field, no one-signature option | Optional arbiter disclosure; "Lock the USDC now" checkbox | Contract features. |
| Create summary | 4 bullets | + arbiter bullet + upgrade-delay note | INTEGRATION §2 must. |
| Dashboard receiving tab | Shows Created escrows | Recipients only ever list funded escrows; an arbiter tab is added | Contract indexing. |
| Find "Try one" | `#0042 #0050 #0099` | The three newest real ids | Real data. |
| Landing photos | `/_blob/…` | Local placeholders (§2.7) | Files not in repo. |
| App pages | No footer | Slim AppFooter (contract, notice period, admin) | INTEGRATION §2. |

Repo doc nit found while planning (not the app's job): CONTRACT.md's `create` row says "indexed for
payer, recipient, arbiter". The code (and the same page's "Unfunded escrows stay private" section)
indexes only the payer at creation.

---

## 12. Deferred (explicitly out of this phase)

- `terms_hash` (hash of an off-chain agreement document).
- Address book / contact labels, and look-alike address flagging (INTEGRATION §6 "should").
- Blocking senders (INTEGRATION §7 "should"). Hiding per escrow ships.
- Push or email notifications for upgrade events.
- `extend_index_ttl` keeper calls. `extend_escrow_ttl` ships for 60-day-old open escrows.
- An `/activity` page across all escrows (Hodl had one; the design has none).
- OG share images.
- Mainnet. Config refuses anything but the pinned Testnet USDC.

---

## Deviations (recorded by the Coding agent)

Smallest sound changes made while building, with the reason for each.

| Where | Plan says | Built | Why |
|---|---|---|---|
| §2.7 photos | SVG placeholders with `alt=""` | The real photos from `docs/design/assets/` copied to `public/images/{hero-payer,hero-recipient,freelance,market,trade}.jpg`, served with `next/image` and the boards' alt texts | The coordinator supplied the files; placeholders were only a stopgap for their absence. |
| §2.1 tokens | Fixed token list | Added `--color-header-glass`, `--color-scrim`, `--shadow-demo`, `--shadow-proof`, `--shadow-float-sm` | Values the boards use (phone header backdrop, modal scrim, three shadows) that had no token. |
| §1 `vitest.config.ts` | `.ts` | `vitest.config.mts` | Vite 8 warns about ESM syntax in a CommonJS-loaded config; `.mts` is the documented fix. |
| §1 `(site)/layout.tsx` | SiteHeader, ContractNotices, SiteFooter | Same, with the header anchors / "Open app" target and the footer variant picked by pathname | `/` and `/rules` need different anchors and footers (Main vs Rules boards). |
| §1 `lib/sisonke` | No role module | `lib/sisonke/role.ts` (`roleOf`, `roleLabel`); `precheck()` lives in `lib/stellar/tx.ts` | Keeps the pure role and pre-check logic testable next to their callers. |
| §3.6 token check | `escrow.token == info.token` | `escrow.token == config.usdcSacId` | Equivalent once the startup check (`info.token == usdcSacId`) passes, and the page doesn't wait for `info()` before showing an amount. |
| §3.6 parties card | No heading on the board | Heading "Who's in it" | A section needs an accessible name. |
| §3.6 details | Countdown or "Passed" | Closed escrows show "Closed before it" when the deadline hadn't passed | A countdown is meaningless on a final escrow. |
| §2.3 motion | `AnimatePresence` for action-card swaps | CSS `.slidein` | Same visual; the plan allows CSS for anything the boards animate in CSS. |
| §6.7 migration | Any read or write hitting 141 | The card appears after a write fails with 141 | Reads (`info`, `get_escrow`) never return 141, and `info()` can't tell a pending migration apart. |
| §3.3 dashboard | `Hide` button on each row | Hide/Unhide sits in the row's corner outside the row link; the collapsed row also counts "M hidden by you" | A button inside a link is invalid HTML. |
| §7 DEX swap | One button | Two clicks: "Swap XLM for 10 USDC" fetches the quote and shows "About X XLM, at most Y XLM.", then "Swap now" signs | The plan requires showing the quote before signing. |
| §3.5 balance error | Always when above the balance | Only when the wallet has a USDC trustline; otherwise the hint says "No USDC yet…" and `create` stays possible | Creating needs no USDC; the deposit pre-check catches it later. |
| §3.1 / §3.7 copy | Board sentences listing two final statuses | "Released, Refunded, Split or Cancelled" where the full signer table is shown | The tables now list all nine rows (§3.7), so the text beside them must match. |
| §3.6 invalid id | Not-found card | `/escrow/abc` renders the not-found card with HTTP 200 (client-rendered inside Suspense) | Under Cache Components the shell is prerendered; status codes for client-validated ids would need a dynamic server read the plan rules out (§3.6, no chain read in the page). |
| §8.3 titles | Trim ends, reject hidden characters | Hidden characters are checked on the raw text before trimming | `trim()` removes U+FEFF, which silently accepted a leading/trailing BOM (bug found by the unit tests). |
| §9.4 fixtures | `run.json` from the e2e run | `screens.e2e.mjs` works without it: final states use live escrows 1–6; open states use fixtures it creates once in Node (Testnet escrows #7 Created, #8 Funded, #9 Disputed, 0.1 USDC each from the funder) cached in `e2e/.out/fixtures.json` | Screenshots of every status without running the full write e2e. The 0.2 USDC in #8/#9 stays locked until their payer (the funder) releases or reclaims after 7 days. |
| §9.4 capture | Wait for animations | Screenshots use Playwright `animations: "disabled"` and scroll through the page first | Full-page capture otherwise caught the header mid fade-in, and `next/image` lazy-loads photos below the fold. |
