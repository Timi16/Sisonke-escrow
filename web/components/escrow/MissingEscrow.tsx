"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEscrowQuery } from "@/lib/api";
import { padId } from "@/lib/format";

const CHECKS = [
  "Is the number right? Numbers are short, like 42.",
  "Ask the person who sent it for the full link.",
  "It may not exist yet. It appears the moment the payer signs.",
];

/** No escrow with this id (or the id isn't one): the red card, three checks and a search box. */
export function MissingEscrow({ id }: { id: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [invalid, setInvalid] = useState(false);
  const label = /^\d{1,15}$/.test(id) ? padId(id) : "#";
  const go = () => {
    const parsed = parseEscrowQuery(q);
    if (!parsed) return setInvalid(true);
    setInvalid(false);
    router.push(`/find?id=${parsed}`);
  };
  return (
    <div className="flex flex-col gap-[22px]">
      <h1 className="sr-only">Escrow not found</h1>
      <section aria-live="polite" className="popin flex flex-col gap-3.5 rounded-card bg-error-bg px-6 py-5">
        <p className="m-0 flex flex-wrap items-center gap-3.5">
          <span className="display text-[22px] text-error">{label}</span>
          <span className="text-[15px] font-bold">No escrow with that number.</span>
        </p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm leading-normal text-muted">
          {CHECKS.map((c) => (
            <li key={c} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-pill bg-error" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>
      <form
        className="flex flex-wrap gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label htmlFor="missing-q" className="sr-only">
          Look up another escrow
        </label>
        <div className="flex min-h-[52px] min-w-0 flex-[999_1_240px] items-center gap-2.5 rounded-pill border-[1.5px] border-ink bg-card px-5 focus-within:border-violet">
          <span aria-hidden="true" className="display text-[21px] text-faint">
            #
          </span>
          <input
            id="missing-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="0042"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "missing-q-err" : undefined}
            className="display min-w-0 flex-auto border-0 bg-transparent text-[21px] text-ink outline-none focus-visible:outline-none"
          />
        </div>
        <button type="submit" className="lift-app min-h-[52px] flex-[1_1_140px] rounded-pill border-0 bg-ink px-7 text-[15px] font-extrabold text-on-ink">
          Search
        </button>
        {invalid && (
          <p id="missing-q-err" role="alert" className="m-0 w-full text-[13px] font-semibold text-error">
            That doesn&apos;t look like an escrow number. Try 42, #0042 or a Sisonke escrow link.
          </p>
        )}
      </form>
    </div>
  );
}
