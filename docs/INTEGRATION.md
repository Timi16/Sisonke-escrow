# Integrating with sisonke-escrow

Requirements for any web app, wallet, bot or indexer that shows Sisonke escrows to people. They
follow from the contract's rules ([CONTRACT.md](CONTRACT.md)) and from the security review
([AUDIT.md](AUDIT.md)). "Must" items are what keeps users from being misled; skipping one can make
a correct contract look like it lost or owes money.

## 1. Know which contract and token you are talking to

- **Must** read the contract id from `deployments/<network>.env`
  (`NEXT_PUBLIC_SISONKE_CONTRACT_ID`), not from user input or a URL parameter.
- **Must** check `token()` equals the pinned USDC SAC for the network
  (`NEXT_PUBLIC_USDC_SAC_ID`; Testnet `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) before
  showing any amount. If it doesn't, refuse to show the instance at all.
- **Must** check `escrow.token == token()` for each escrow before rendering its amount as USDC.
- Show amounts from `escrow.amount` with 7 decimals (`10_000_000` = 1 USDC). Never round toward the
  user's favour.

## 2. Upgrades: show the pending upgrade, and what each party can do about it

The admin (a multisig account) can replace the code, but only after a public delay, and only within
7 days after it (`eta` to `expires_at`). During the delay every exit function works, but what it can
do depends on the role and the deadline:
- before an escrow's deadline, its funds can only go **toward the counterparty** (the payer
  `release`s, the recipient `refund`s) or through the arbiter in a dispute;
- the payer can only take funds back alone (`reclaim`) after the deadline.

The protection only helps users who notice, so:

- **Must** read `pending_upgrade()` (or `info().pending_upgrade_hash` / `pending_upgrade_eta` /
  `pending_upgrade_expires_at`) on every page load. When it is `Some`, show a **prominent,
  non-dismissable banner** on every page.
  - **Before `eta`:** "An upgrade of this contract has been proposed (code `<hash>`) and can take
    effect from `<eta, local time and countdown>`. If you don't trust it, settle your escrows before
    then. As a payer before your deadline you can release to the recipient, or ask them to refund
    you. As a recipient you can refund the payer. In a dispute, ask the arbiter to resolve. After
    an escrow's deadline, the payer can reclaim."
  - **Per escrow:** say which of these the viewer can do *alone, now* (from the role and
    `deadline_passed`). Prompt both parties of every open escrow to settle cooperatively.
  - **From `eta` to `expires_at`:** "This upgrade **can take effect at any moment until
    `<expires_at>`**."
  - **After `expires_at`:** "The proposal expired and can't run; a new proposal would start a new
    delay."
- **Must** check that the proposed wasm is published: read the `ContractCode` ledger entry for the
  hash, or try `stellar contract fetch --wasm-hash <hash>`. If it isn't, say "the proposed code isn't
  published yet; it can't be reviewed" and treat the proposal as hostile. Link the hash to its
  verification instructions (UPGRADES.md "Shipping a v2", step 6).
- Show `upgrade_delay()` (read it: the contract accepts any delay from 60 s to 30 days, whatever
  the deploy policy was), `upgrades_enabled()` (when `false`: "the code is final") and `admin()` in
  the footer or an "About this contract" page.
- When the user creates or funds an escrow, compare its deadline with `upgrade_delay()`. If the
  deadline is later, tell the payer that during a future upgrade proposal they could only get the
  money back with the recipient's cooperation (or the arbiter's) until the deadline. Suggest a
  shorter deadline if they want a unilateral exit.
- Subscribe to `("sisonke", "upgrade_proposed")`, `("sisonke", "upgrade_cancelled")`,
  `("sisonke", "upgraded")` and `("sisonke", "upgrade_delay_changed")` (which carries the pending
  proposal's new `pending_eta`) if you notify users by email or push. A proposal is exactly the
  moment to tell everyone with open escrows. Replacing a proposal emits `upgrade_cancelled` for the
  old hash first.
- When writes fail with 141 `MigrationRequired`, a migration is pending (normally only for seconds
  after an upgrade). Say so plainly and offer the permissionless `migrate` call: anyone can end
  that state.

## 3. Funding state comes from the chain only

- **Must** derive "funded", "locked", "paid" and "refunded" only from the on-chain `status` and the
  `paid_to_*` fields returned by `get_escrow` / `get_escrows`, freshly read. Never from a form the
  user filled, from local storage, or from the title.
- **Must** label `Created` escrows **"Awaiting deposit — not funded"**. They hold no money. Never
  show their amount as owed, incoming or locked.
- Statuses say where the money went: `Released` = all to the recipient, `Refunded` = all to the payer
  (whoever closed it; see `closed_by` and the event name), `Split` = both (`paid_to_recipient`,
  `paid_to_payer`), `Cancelled` = never funded. Use the table in CONTRACT.md "Functions versus
  statuses" for wording; don't call a payer's `reclaim` a "refund by the recipient".
- Show `deadline_passed` from the read, not from the browser clock, for what is allowed now. Ledger
  time can differ from the user's clock by minutes.

## 4. Never trust event data alone for balances

- Events (`getEvents`) are a history and a notification channel. **Must not** compute balances,
  totals or "funds locked" from events alone: RPC keeps them for about 7 days, a page can miss some,
  and the USDC issuer can freeze or claw back outside the contract.
- For a balance, read `token.balance(...)` (SAC) and `total_locked()`; for an escrow, read
  `get_escrow`. Use events to know *when* something happened (link each to its transaction on the
  explorer), and fall back to the stored `created_at` / `funded_at` / `closed_at` fields.

## 5. Titles are text, never markup

The contract only accepts titles of at most 64 bytes of valid UTF-8 with no control characters
(error 128). That stops broken encodings, not deception.

- **Must** render `title` as plain text: escape it (or use a text node), never `innerHTML`, never
  markdown, never as a link or button label that looks like it came from Sisonke.
- **Should** strip or visibly mark Unicode bidirectional overrides (U+202A–U+202E, U+2066–U+2069)
  and zero-width characters (U+200B–U+200D, U+FEFF), and truncate long titles visually.
- Never let a title imply status ("PAID", "Refund approved"): the status badge comes from §3.

## 6. Parties: show the arbiter, warn when it is unknown

- **Must** show the payer, the recipient and the arbiter (or "no arbiter: no dispute possible") on
  every escrow, with full addresses available.
- **Must** warn the recipient when the arbiter is unknown to them: the payer alone chooses the
  arbiter, and a payer-controlled arbiter can decide a dispute for the payer (CONTRACT.md rule 5).
  Show the arbiter's history (`party_escrow_count(arbiter, Arbiter)` and outcomes) and say a
  recipient who doesn't trust it shouldn't start work.
- **Should** let users label known addresses (contacts), and flag look-alike addresses.

## 7. Lists, pagination, and unsolicited escrows

- List a user's escrows with `party_escrow_count` + `party_escrow_ids(party, role, page)` (50 per
  page), then `get_escrows` in batches of at most 20.
- The payer's list holds every escrow they created. The recipient's and arbiter's lists only hold
  **funded** escrows (in funding order), so unfunded spam never reaches them. An escrow reached by id
  or link may still be `Created`: label it as in §3.
- Funded escrows from strangers cost almost nothing: 1 stroop, funded with a deadline seconds away
  and reclaimed by the sender a ledger later. They stay in the recipient's list as closed
  `Refunded` entries with whatever title the sender chose. So:
  - **Must** show each escrow's amount prominently, next to its title.
  - **Should** collapse or hide, by default, escrows the user never interacted with that are tiny
    (below a minimum amount you choose), lived only briefly (closed within, say, an hour of
    creation), or were reclaimed by their own payer.
  - **Should** let users hide any escrow from their own view (client-side), and block senders.
  - Offer a one-click `refund` for an open escrow the recipient doesn't recognise.

## 8. Before offering an action

- Offer only actions the signer can actually take (CONTRACT.md "Signer table"): `release` to the
  payer, `refund` to the recipient, `reclaim` to the payer at or after the deadline unless disputed,
  `dispute` to payer or recipient before the deadline with an arbiter, `resolve` to the arbiter while
  disputed, `cancel` to the payer before funding.
- Stop offering `dispute` well before the deadline (for example 10 minutes): a dispute that lands
  after it fails with 102 and the payer can reclaim.
- Check USDC trustlines of whoever will receive funds before offering `release`, `refund` or a
  split: a missing or frozen trustline makes the transfer, and the whole call, fail.
- Simulate every transaction first and show the simulated result, including errors by name (the
  code list in CONTRACT.md "Errors").

## 9. Keep entries alive

Reads don't extend TTLs. For long-lived escrows, call `extend_escrow_ttl(id)` for open escrows older
than 60 days and `extend_index_ttl(party, role, page)` for active users' index pages (both
permissionless, no event), or run a keeper (CONTRACT.md "Storage", TTL).
