<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Sisonke web rules (docs/WEB_PLAN.md §8)

- Precedence when sources disagree: the contract (`contracts/sisonke-escrow/src`, `docs/CONTRACT.md`) >
  `docs/INTEGRATION.md` > `docs/WEB_PLAN.md` (incl. §11 copy corrections) > `docs/design/*.dc.html` > Hodl style.
- Never use `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `eval`, `new Function` or string `setTimeout`. ESLint and `tests/no-raw-html.test.ts` enforce this.
- Chain strings (titles, addresses, hashes, event data) render as React text only. Titles go through
  `displayTitle()` and never reach `document.title`, metadata, links or button labels.
- `href`s come only from `config` plus validated values (`explorer.*` validates and throws). External
  links get `target="_blank" rel="noopener noreferrer"`.
- Status, amounts and permissions come only from fresh chain reads (`get_escrow`, `deadline_passed`),
  never from events, local storage, form input or the title. Nothing is optimistic.
- Money is `bigint` stroops end to end: no `Number`, `parseFloat` or float maths on amounts.
- Every write goes through `lib/stellar/tx.ts`: simulate first, source-account auth only, verify the
  signed envelope's hash and signature before sending. The source is always the connected wallet.
- `localStorage` holds only the wallets kit session and hidden ids, every access in try/catch.
- Contract and token ids come only from config, never from URLs or input. Every env var is
  `NEXT_PUBLIC_*` and public; no secrets in `web/`.
- Colours, shadows, radii and easings come from the tokens in `app/globals.css`, not raw values.
- Pin dependencies exactly; keep the `allowBuilds` deny-list in `pnpm-workspace.yaml`.
