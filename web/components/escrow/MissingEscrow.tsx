"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEscrowQuery } from "@/lib/api";
import { padId } from "@/lib/format";
import { FieldError } from "@/components/ui/Field";

/** The dashed two-ring mark with a "?" (Lookup board's not-found card). */
function MissingMark() {
  return (
    <div
      aria-hidden="true"
      className="wobble flex size-28 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-ink bg-card"
    >
      <svg width="64" height="64" viewBox="0 0 34 34">
        <circle cx="12" cy="17" r="9" fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeDasharray="3 3" />
        <circle cx="22" cy="17" r="9" fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeDasharray="3 3" />
        <text x="17" y="21" textAnchor="middle" fontFamily="var(--font-anton), Impact, sans-serif" fontSize="11" fill="var(--color-violet)">
          ?
        </text>
      </svg>
    </div>
  );
}

const CHECKS = [
  "Is the number right? IDs are short, like 42.",
  "Ask the person who sent it for the full link.",
  "It may not be created yet. It appears the moment the payer signs.",
];

/** "No escrow #0099" with the three checks. `id` is a validated decimal id, or any text when invalid. */
export function NotFoundCard({ id, className }: { id: string; className?: string }) {
  const label = /^\d{1,15}$/.test(id) ? padId(id) : "with that ID";
  return (
    <article aria-live="polite" className={`slide-up flex flex-wrap items-center gap-x-9 gap-y-6 rounded-panel bg-sand px-7 py-9 ${className ?? ""}`}>
      <MissingMark />
      <div className="flex flex-[1_1_320px] flex-col gap-3">
        <h2 className="display m-0 text-[clamp(30px,3.4vw,44px)]">No escrow {label}</h2>
        <p className="m-0 text-base leading-[1.55] text-muted">The Sisonke contract on Testnet has nothing with that ID. A few things to check:</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-normal">
          {CHECKS.map((c) => (
            <li key={c} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-pill bg-violet" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** Not found or invalid id on the escrow page: the card plus a small Find box. */
export function MissingEscrow({ id }: { id: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [invalid, setInvalid] = useState(false);
  const go = () => {
    const parsed = parseEscrowQuery(q);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    router.push(`/find?id=${parsed}`);
  };
  return (
    <div className="flex flex-col gap-6">
      <NotFoundCard id={id} />
      <form
        className="flex flex-col gap-3 rounded-panel border border-line bg-card p-[26px]"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label htmlFor="missing-q" className="text-base font-bold">
          Look up another escrow
        </label>
        <div className="flex flex-wrap gap-2.5">
          <input
            id="missing-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. 42"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "missing-q-err" : undefined}
            className="min-h-[54px] min-w-0 flex-[1_1_220px] rounded-note border-[1.5px] border-line-strong bg-ground px-[18px] text-lg font-semibold text-ink outline-none focus:border-violet"
          />
          <button type="submit" className="display lift min-h-[54px] rounded-pill border-[1.5px] border-ink bg-lime px-7 text-xl text-ink">
            Find it
          </button>
        </div>
        <FieldError id="missing-q-err">{invalid ? "That doesn't look like an escrow ID. IDs are numbers, like 42, or a Sisonke escrow link." : null}</FieldError>
      </form>
    </div>
  );
}
