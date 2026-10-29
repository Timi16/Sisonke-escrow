import { cn } from "@/lib/cn";
import { config, explorer, repoLink } from "@/lib/config";
import { padId } from "@/lib/format";
import proof from "@/lib/generated/proof.json";
import { CONTRACT_ERRORS } from "@/lib/sisonke/errors";
import { STATUSES, type Status } from "@/lib/sisonke/types";
import { Address } from "@/components/ui/Address";
import { StatusChip } from "@/components/ui/StatusChip";
import { TxHash } from "@/components/ui/TxHash";

type Row = (typeof proof)[number];

const SCENARIOS: { key: string; title: string; about: string }[] = [
  { key: "A", title: "A. Two-step happy path", about: "The payer creates it, deposits with a second signature, then releases." },
  { key: "B", title: "B. Recipient refund", about: "Created and funded in one signature. The recipient sends it back." },
  { key: "C", title: "C. Unauthorized", about: "Six calls by the wrong signer, all refused with the money untouched. Then the payer releases." },
  { key: "D", title: "D. Duplicates", about: "The same release, refund and deposit sent a second time." },
  { key: "E", title: "E. Dispute and split", about: "The recipient opens a dispute. The payer can’t reclaim, and the arbiter splits it 0.6 / 0.4." },
  { key: "F", title: "F. Deadline reclaim", about: "The payer tries to take it back early, then does after the deadline." },
  { key: "G", title: "G. Cancel", about: "Cancelled before any deposit. A deposit after that is refused." },
];

const VERB: Record<string, string> = {
  create: "Create",
  create_and_fund: "Create and deposit",
  fund: "Deposit",
  release: "Release",
  refund: "Refund",
  reclaim: "Reclaim",
  dispute: "Open a dispute on",
  resolve: "Decide",
  cancel: "Cancel",
  set_paused: "Pause the contract",
  get_escrow: "Check",
};

/** "release #5 by recipient" → "Release #5 by recipient". */
function stepLabel(r: Row): string {
  if (r.method === "get_escrow") return `Check #${r.escrow_id}: status and the contract’s USDC`;
  const rest = r.step.replace(/^[a-z_]+(\(true\))?/, "");
  return `${VERB[r.method] ?? r.method}${rest}`;
}

const statusIn = (text: string): Status | null => STATUSES.find((s) => new RegExp(`\\b${s}\\b`).test(text)) ?? null;

/** "Error #101 InvalidStatus" → "Already moved on"; auth errors → "Not yours to sign". */
function refusal(text: string): { plain: string; raw: string } {
  const code = /Error #(\d+)/.exec(text);
  if (code) {
    const entry = CONTRACT_ERRORS[Number(code[1])];
    return { plain: entry?.title ?? `Error #${code[1]}`, raw: `error #${code[1]}${entry ? ` ${entry.name}` : ""}` };
  }
  if (/Auth error/.test(text)) return { plain: "Not yours to sign", raw: "auth error" };
  return { plain: text.replace(/^⛔\s*/, ""), raw: "" };
}

function Result({ r }: { r: Row }) {
  if (r.expected.startsWith("⛔")) {
    const f = refusal(r.expected);
    return (
      <span className="text-sm">
        <span aria-hidden="true">⛔ </span>
        <span className="sr-only">Refused: </span>
        <span className="font-semibold">{f.plain}</span>
        {f.raw && <span className="text-muted"> ({f.raw})</span>}
      </span>
    );
  }
  const s = statusIn(r.result);
  return (
    <span className="text-sm">
      <span aria-hidden="true">✅ </span>
      <span className="sr-only">Succeeded: </span>
      <span className="font-semibold">{r.method === "get_escrow" ? `Still ${s ?? "the same"}, funds unchanged` : (s ?? "Done")}</span>
    </span>
  );
}

function Card({ s, rows }: { s: (typeof SCENARIOS)[number]; rows: Row[] }) {
  const finals = rows.filter((r) => r.expected.startsWith("✅") && r.method !== "get_escrow");
  const last = finals.length ? statusIn(finals[finals.length - 1].result) : null;
  const refused = rows.filter((r) => r.expected.startsWith("⛔")).length;
  const ids = [...new Set(rows.map((r) => r.escrow_id).filter((x): x is string => !!x))];
  return (
    <article className="lift-rules flex flex-col gap-4 rounded-card bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h3 className="display m-0 text-[26px]">{s.title}</h3>
        {last ? (
          <StatusChip status={last} size="compact" />
        ) : (
          <span className="inline-flex min-h-7 items-center rounded-pill border-[1.5px] border-error bg-error-bg px-3 text-xs font-bold text-error">
            {refused} refused
          </span>
        )}
      </div>
      <p className="m-0 text-sm text-muted">
        {s.about} {ids.length > 0 && <span className="font-mono text-[13px] text-ink">Escrow {ids.map((i) => padId(i)).join(", ")}</span>}
      </p>
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((r, i) => (
          <li key={`${r.hash ?? "read"}-${i}`} className="flex flex-wrap justify-between gap-x-3 gap-y-1.5 border-t border-sand py-3 text-[15px]">
            <span className="flex min-w-0 flex-[1_1_180px] flex-col gap-1">
              <span>{stepLabel(r)}</span>
              <Result r={r} />
            </span>
            {r.hash ? <TxHash hash={r.hash} className="self-start text-xs" /> : <span className="self-start text-xs text-muted">Read, no transaction</span>}
          </li>
        ))}
      </ol>
    </article>
  );
}

/** One card per Testnet scenario (A–G) from deployments/testnet-e2e.json, with real hashes. Failed ones are on-chain too. */
export function ProofGrid() {
  const repo = repoLink();
  const link = "font-bold text-violet underline-offset-[5px] hover:text-violet";
  return (
    <section id="proof" className="px-3 pb-[72px] min-[720px]:px-8 min-[720px]:pb-28">
      <div className="rise-lg mx-auto flex max-w-[1376px] flex-col gap-9 rounded-panel bg-sand px-[clamp(20px,4vw,72px)] py-[clamp(36px,5vw,80px)] min-[720px]:rounded-section">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div className="flex max-w-[640px] flex-col gap-3.5">
            <h2 className="m-0 font-serif text-[clamp(38px,4.4vw,60px)] leading-[1.02] font-normal">Proof on Stellar Testnet</h2>
            <p className="m-0 text-[17px] leading-[1.6] text-muted">
              Seven scenarios, run end to end on the live contract. Every hash opens on Stellar Expert, the refused ones too: they were
              sent on-chain and failed there.
            </p>
          </div>
          <dl className="m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-[18px] gap-y-2.5 text-sm">
            <dt className="font-bold">Contract</dt>
            <dd className="m-0 min-w-0">
              <Address address={config.contractId} kind="contract" />
            </dd>
            <dt className="font-bold">Deploy</dt>
            <dd className="m-0">
              <TxHash hash={config.deployTx} />
            </dd>
          </dl>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-4">
          {SCENARIOS.map((s) => {
            const rows = proof.filter((r) => r.scenario === s.key);
            return rows.length ? <Card key={s.key} s={s} rows={rows} /> : null;
          })}
        </div>
        <div className={cn("flex flex-wrap gap-x-7 gap-y-3 text-[15px]")}>
          <a href={explorer.contract()} target="_blank" rel="noopener noreferrer" className={link}>
            Open the contract on Stellar Expert
          </a>
          <a href={config.labUrl} target="_blank" rel="noopener noreferrer" className={link}>
            Call it yourself in Stellar Lab
          </a>
          {repo && (
            <a href={repo} target="_blank" rel="noopener noreferrer" className={link}>
              Source code
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
