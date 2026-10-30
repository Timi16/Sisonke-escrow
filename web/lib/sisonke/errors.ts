/**
 * Every failure → plain words (WEB_PLAN §5.3). One mapper serves simulation
 * errors, on-chain failures (decoded by chainError into the same wording),
 * wallet rejections, send results and transport errors.
 */
import { formatUsdc } from "./amount";
import type { Escrow, Status } from "./types";
import { formatWhen } from "../format";

export interface Fix {
  label: string;
  /** Internal path only. */
  href?: string;
  /** Or an in-app action. */
  action?: "migrate";
}

export interface FriendlyError {
  title: string;
  body: string;
  fix?: Fix;
  code?: number;
  hash?: string;
  /** Sent, but the outcome is unknown: don't let the same write be sent again. */
  pending?: boolean;
}

export interface ErrorContext {
  method?: string;
  escrow?: Escrow | null;
}

/** Thrown by our own pre-checks and the pipeline; already in plain words. */
export class SisonkeError extends Error {
  constructor(
    public title: string,
    public body: string,
    public fix?: Fix,
    public hash?: string,
  ) {
    super(`${title}: ${body}`);
  }
}

const MOVED = " Nothing moved.";

/** Contract codes from errors.rs. errors-coverage.test.ts keeps this in sync. */
export const CONTRACT_ERRORS: Record<number, { name: string; title: string; body: (c: ErrorContext) => string; fix?: Fix }> = {
  100: { name: "NotFound", title: "No escrow with that ID", body: () => "The Sisonke contract on Testnet has nothing with this ID. Check the number, or ask for the full link." },
  101: { name: "InvalidStatus", title: "Already moved on", body: invalidStatus },
  102: {
    name: "DeadlinePassed",
    title: "Too late",
    body: (c) =>
      (c.method === "dispute"
        ? "The deadline has passed, so a dispute can't be opened. The payer can now reclaim."
        : "The deadline has passed, so the contract won't take a deposit. You can cancel this escrow.") + MOVED,
  },
  103: {
    name: "DeadlineNotReached",
    title: "Not yet",
    body: (c) => `The deadline hasn't passed. The payer can't take the money back before ${c.escrow ? formatWhen(c.escrow.deadline) : "the deadline"}.${MOVED}`,
  },
  104: {
    name: "NoArbiter",
    title: "No arbiter on this escrow",
    body: () => "It was created without an arbiter, so there's no dispute. The money moves only by release, refund, or reclaim after the deadline." + MOVED,
  },
  105: { name: "NotParty", title: "Not part of this escrow", body: () => "Only the payer or the recipient can open a dispute." + MOVED },
  106: {
    name: "InvalidSplit",
    title: "Check the split",
    body: (c) => `The recipient's share must be between 0 and ${c.escrow ? formatUsdc(c.escrow.amount) : "the escrow's"} USDC.${MOVED}`,
  },
  107: {
    name: "TransferMismatch",
    title: "The deposit didn't add up",
    body: (c) => `The contract didn't receive exactly ${c.escrow ? formatUsdc(c.escrow.amount) : "the escrow amount in"} USDC, so it refused the deposit.${MOVED}`,
  },
  120: { name: "InvalidAmount", title: "Check the amount", body: () => "Enter an amount above zero. Nothing was sent." },
  121: { name: "SameParty", title: "That's your own address", body: () => "You can't pay yourself. Use the recipient's address. Nothing was sent." },
  122: { name: "InvalidArbiter", title: "Pick a different arbiter", body: () => "The arbiter must be someone other than you and the recipient. Nothing was sent." },
  123: { name: "InvalidParty", title: "That's the escrow contract", body: () => "The payer, recipient and arbiter must be wallets, not the Sisonke contract itself. Nothing was sent." },
  124: { name: "DeadlineInPast", title: "Deadline already passed", body: () => "Pick a deadline in the future. Nothing was sent." },
  125: { name: "DeadlineTooFar", title: "Deadline too far away", body: () => "Pick a deadline within 365 days. Nothing was sent." },
  126: { name: "TitleTooLong", title: "Note too long", body: () => "Keep it to 64 bytes. Some characters, like emoji, take up to 4. Nothing was sent." },
  127: { name: "BatchTooLarge", title: "Too many at once", body: () => "The app asked for more than 20 escrows in one read. Refresh to try again." },
  128: { name: "InvalidTitle", title: "Note has hidden characters", body: () => "Remove line breaks, tabs and other control characters. Nothing was sent." },
  140: {
    name: "Paused",
    title: "Paused right now",
    body: () => "The contract admin has paused new escrows and deposits. Every way out (release, refund, reclaim, dispute, decide, cancel) still works." + MOVED,
  },
  141: {
    name: "MigrationRequired",
    title: "Contract update in progress",
    body: () => "The contract's code was just upgraded and its data needs a one-time migration. Anyone can run it." + MOVED,
    fix: { label: "Run the migration", action: "migrate" },
  },
  142: { name: "NothingToMigrate", title: "Already up to date", body: () => "The migration has already run. Try your action again." },
  143: { name: "Overflow", title: "Number too large", body: () => "A counter in the contract would overflow, so it refused." + MOVED },
  200: { name: "UpgradesLocked", title: "The code is final", body: () => "Upgrades are locked for good." },
  201: { name: "NoPendingAdmin", title: "No admin change pending", body: () => "There is no admin handover to accept or cancel." },
  202: { name: "InvalidUpgradeDelay", title: "Upgrade delay out of range", body: () => "It must be between 60 seconds and 30 days." },
  203: { name: "NoPendingUpgrade", title: "No upgrade proposed", body: () => "There is no upgrade to run or cancel." },
  204: { name: "UpgradeTooEarly", title: "Too early to upgrade", body: () => "The public notice period hasn't ended." },
  205: { name: "UpgradeDelayDecrease", title: "The notice period can only grow", body: () => "A lower delay would need its own delay to be safe." },
  206: { name: "UpgradeHashMismatch", title: "Different code than proposed", body: () => "The hash doesn't match the proposed upgrade." },
  207: { name: "UpgradeExpired", title: "Upgrade proposal expired", body: () => "It must be proposed again, with a fresh notice period." },
};

const VERB: Record<string, string> = { release: "release", refund: "refund", reclaim: "take back" };

function invalidStatus(c: ErrorContext): string {
  const status: Status | undefined = c.escrow?.status;
  const final: Partial<Record<Status, string>> = { Released: "released", Refunded: "refunded", Split: "split", Cancelled: "cancelled" };
  let body: string;
  if (c.method === "fund" && status && status !== "Created" && !final[status]) {
    body = "This escrow is already funded. It can't be funded twice.";
  } else if (status && final[status]) {
    body = `This escrow is already ${final[status]}. Nothing pays out twice.`;
  } else if (c.method && VERB[c.method] && status === "Created") {
    body = `Nothing is locked yet, so there's nothing to ${VERB[c.method]}.`;
  } else if (c.method === "reclaim" && status === "Disputed") {
    body = "A dispute is open, so only the arbiter can send money back.";
  } else if (c.method === "fund") {
    body = "This escrow is already funded. It can't be funded twice.";
  } else {
    body = "The escrow's status doesn't allow that any more. Refresh to see where it is.";
  }
  return body + MOVED;
}

/** Whose wallet a USDC SAC error is about, from the method. */
function whose(method?: string): { label: string; own: boolean } {
  switch (method) {
    case "fund":
    case "create_and_fund":
      return { label: "Your", own: true };
    case "release":
      return { label: "The recipient's", own: false };
    case "refund":
    case "reclaim":
      return { label: "The payer's", own: false };
    case "resolve":
      return { label: "The payer's or the recipient's", own: false };
    default:
      return { label: "A", own: false };
  }
}

/** USDC SAC (token) codes that reach the caller unchanged. */
export function sacError(code: number, c: ErrorContext): FriendlyError {
  const w = whose(c.method);
  const lower = w.label === "A" ? "a" : w.label.charAt(0).toLowerCase() + w.label.slice(1);
  switch (code) {
    case 6:
      return { code, title: "That wallet isn't on Testnet yet", body: `${w.label} wallet needs test XLM first.${MOVED}`, fix: w.own ? { label: "Get test XLM", href: "/setup" } : undefined };
    case 10:
      return { code, title: "Not enough USDC", body: `${w.label} wallet doesn't hold enough USDC for this.${MOVED}`, fix: w.own ? { label: "Get test USDC", href: "/setup" } : undefined };
    case 11:
      return { code, title: "USDC is frozen on that wallet", body: `Circle has frozen USDC for ${lower} wallet, so it can't send or receive it.${MOVED}` };
    case 13:
      return {
        code,
        title: `${w.label} wallet can't hold USDC yet`,
        body: `Add the USDC trustline in Test funds. It takes one signature.${MOVED}`,
        fix: w.own ? { label: "Add the trustline", href: "/setup" } : undefined,
      };
    default:
      return { code, title: "USDC refused the transfer", body: `The USDC contract returned error #${code}.${MOVED}` };
  }
}

const ROLE_FOR: Record<string, string> = {
  fund: "payer",
  create: "payer",
  create_and_fund: "payer",
  cancel: "payer",
  release: "payer",
  reclaim: "payer",
  refund: "recipient",
  resolve: "arbiter",
  dispute: "payer or the recipient",
};

const SEND_CODES: Record<string, { title: string; body: string; fix?: Fix }> = {
  txBadSeq: { title: "Try again", body: "Your account changed since we checked. Try again. Nothing was sent." },
  txInsufficientBalance: { title: "Not enough XLM", body: "Not enough XLM for the fee. Get test XLM in Test funds. Nothing was sent.", fix: { label: "Get test XLM", href: "/setup" } },
  txInsufficientFee: { title: "Fee too low", body: "Stellar wanted a higher fee. Try again. Nothing was sent." },
  txTooLate: { title: "It expired", body: "It expired before it was sent. Try again. Nothing was sent." },
  txBadAuth: { title: "Signature didn't match", body: "The signature didn't match. Is your wallet on Testnet? Nothing was sent." },
};

const WALLET_REJECT = /reject|declin|denied|cancel|closed the modal|user refused/i;
const TRANSPORT = /fetch|network|timeout|ECONN|Failed to fetch/i;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const m = (err as { message?: unknown })?.message;
  return typeof m === "string" ? m : String(err);
}

/** The contract code in "Error(Contract, #101)", if any. */
export function contractCode(raw: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  return m ? Number(m[1]) : null;
}

export function toSisonkeError(err: unknown, context: ErrorContext = {}): FriendlyError {
  const hash = (err as { hash?: string } | null)?.hash;
  const withHash = (e: FriendlyError): FriendlyError => (hash ? { ...e, hash } : e);
  if (err instanceof SisonkeError) return { title: err.title, body: err.body, fix: err.fix, hash: err.hash ?? hash };
  const raw = messageOf(err);

  const code = contractCode(raw);
  if (code !== null) {
    if (code >= 100) {
      const entry = CONTRACT_ERRORS[code];
      if (entry) return withHash({ code, title: entry.title, body: entry.body(context), fix: entry.fix });
      return withHash({ code, title: "The contract refused", body: `The contract returned error #${code}.${MOVED}` });
    }
    return withHash(sacError(code, context));
  }
  if (/Error\(Auth,/.test(raw)) {
    const who = (context.method && ROLE_FOR[context.method]) || "right party";
    return withHash({ title: "Not yours to sign", body: `The contract only accepts this from the ${who}.${MOVED}` });
  }
  const walletCode = (err as { code?: unknown } | null)?.code;
  if (walletCode === -4 || WALLET_REJECT.test(raw)) {
    return { title: "You rejected it in your wallet", body: "Nothing was sent and nothing changed. Try again whenever you're ready." };
  }
  for (const [name, e] of Object.entries(SEND_CODES)) {
    if (raw.includes(name)) return withHash(e);
  }
  if (/TRY_AGAIN_LATER/.test(raw)) return { title: "Stellar is busy", body: "Stellar is busy. Try again in a moment. Nothing was sent." };
  if (TRANSPORT.test(raw)) return { title: "Couldn't reach Stellar", body: "Check your connection and try again." };
  return withHash({ title: "Something went wrong", body: raw.split("\n")[0].slice(0, 200) });
}
