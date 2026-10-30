"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseEscrowQuery } from "@/lib/api";
import { padId, shortAddress } from "@/lib/format";
import { useInfo } from "@/lib/hooks/queries";
import { formatUsdc } from "@/lib/sisonke/amount";
import { toSisonkeError } from "@/lib/sisonke/errors";
import { getEscrow } from "@/lib/sisonke/reads";
import { statusSentence } from "@/lib/sisonke/status";
import { displayTitle } from "@/lib/sisonke/title";
import type { EscrowView } from "@/lib/sisonke/types";
import { PageHead } from "@/components/app/PageHead";
import { AppChips } from "@/components/ui/AppChip";
import { ArrowIcon, Spinner } from "@/components/ui/icons";
import { ReadError } from "@/components/ui/Skeleton";

type Result =
  | { kind: "searching"; id: string }
  | { kind: "found"; id: string; view: EscrowView }
  | { kind: "missing"; id: string }
  | { kind: "invalid" }
  | { kind: "error"; id: string; reason: string };

/** The result: the whole card links to the escrow. */
function FoundCard({ view, tokenOk }: { view: EscrowView; tokenOk: boolean }) {
  const e = view.escrow;
  const t = displayTitle(e.title);
  return (
    <Link
      href={`/escrow/${e.id.toString()}`}
      aria-label={`Open escrow ${padId(e.id)}`}
      aria-describedby="found-story"
      className="popin lift-app flex flex-wrap items-center gap-x-7 gap-y-4 rounded-card border border-line bg-card px-6 py-[22px] text-ink no-underline hover:text-ink"
    >
      <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-2">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[13px] text-muted">{padId(e.id)}</span>
          <AppChips status={e.status} deadlinePassed={view.deadlinePassed} />
        </span>
        <span className="line-clamp-2 font-serif text-2xl leading-[1.05] break-words" title={t.text}>
          {t.empty ? <span className="text-muted">Untitled escrow</span> : t.text}
          {t.stripped && <span className="ml-2 font-sans text-[13px] text-muted">(hidden characters removed)</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2 font-mono text-[13px] text-muted">
          <span title={e.payer}>{shortAddress(e.payer)}</span>
          <ArrowIcon size={18} className="text-ink" />
          <span title={e.recipient}>{shortAddress(e.recipient)}</span>
        </span>
        <span id="found-story" className="text-[13px] text-muted">
          {tokenOk ? statusSentence(view) : "Unknown token, amount hidden."}
        </span>
      </div>
      {tokenOk && (
        <span className="flex items-baseline gap-1.5">
          <span className="display tabular text-[26px]">{formatUsdc(e.amount)}</span>
          <span className="text-xs font-bold text-muted">USDC</span>
        </span>
      )}
      <span aria-hidden="true" className="flex size-[52px] items-center justify-center rounded-pill bg-lime">
        <ArrowIcon size={20} />
      </span>
    </Link>
  );
}

export function FindScreen({ fallback = false }: { fallback?: boolean }) {
  // Hooks that read the URL only run inside the Suspense boundary.
  return fallback ? <FindBody initial={null} /> : <FindWithParams />;
}

function FindWithParams() {
  const params = useSearchParams();
  return <FindBody initial={params.get("id")} />;
}

function FindBody({ initial }: { initial: string | null }) {
  const router = useRouter();
  const info = useInfo();
  const [query, setQuery] = useState(initial ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const run = useRef(0);
  const count = info.data?.info?.escrowCount ?? null;
  const token = info.data?.info?.token ?? null;

  async function search(raw: string, updateUrl = true) {
    const id = parseEscrowQuery(raw);
    const n = ++run.current;
    if (!id) {
      setResult({ kind: "invalid" });
      return;
    }
    if (updateUrl) router.replace(`/find?id=${id}`, { scroll: false });
    // An id above escrow_count can't exist: no call needed.
    if (count !== null && BigInt(id) > count) {
      setResult({ kind: "missing", id });
      return;
    }
    setResult({ kind: "searching", id });
    try {
      const view = await getEscrow(BigInt(id));
      if (n !== run.current) return;
      setResult(view ? { kind: "found", id, view } : { kind: "missing", id });
    } catch (err) {
      if (n !== run.current) return;
      setResult({ kind: "error", id, reason: toSisonkeError(err).body });
    }
  }

  // /find?id=42 prefills the box and searches once the count is known.
  const searchedInitial = useRef(false);
  useEffect(() => {
    if (!initial || searchedInitial.current || info.isLoading) return;
    searchedInitial.current = true;
    setQuery(initial);
    void search(initial, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, info.isLoading]);

  // The four newest real ids.
  const picks = count && count > 0n ? [0n, 1n, 2n, 3n].map((d) => count - d).filter((x) => x >= 1n).map((x) => x.toString()) : [];

  return (
    <main id="main" className="flex flex-col gap-[22px]">
      <PageHead title="Find an escrow" sub="Anyone can view. Only the people in it can act." />
      <form
        className="rise flex flex-wrap gap-2.5"
        style={{ animationDelay: "100ms" }}
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Escrow number or link
        </label>
        <div className="flex min-h-[52px] min-w-0 flex-[999_1_260px] items-center gap-2.5 rounded-pill border-[1.5px] border-ink bg-card px-5 focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-violet">
          <span aria-hidden="true" className="display text-[21px] text-faint">
            #
          </span>
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="0042"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={result?.kind === "invalid" || undefined}
            aria-describedby={result?.kind === "invalid" ? "q-invalid" : undefined}
            className="display min-w-0 flex-auto border-0 bg-transparent text-[21px] text-ink outline-none focus-visible:outline-none"
          />
        </div>
        <button type="submit" className="lift-app min-h-[52px] flex-[1_1_140px] rounded-pill border-0 bg-ink px-7 text-[15px] font-extrabold text-on-ink">
          Search
        </button>
      </form>
      {picks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          <span className="sr-only">Newest escrows:</span>
          {picks.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setQuery(p);
                void search(p);
              }}
              className="min-h-9 rounded-pill border-0 bg-sand px-3 font-mono text-[13px] text-ink"
            >
              {padId(p)}
            </button>
          ))}
        </div>
      )}

      {result?.kind === "searching" && (
        <div aria-live="polite" className="slidein flex items-center gap-3.5 rounded-card bg-sand px-6 py-5 text-[15px] font-semibold">
          <Spinner track="var(--color-line-strong)" />
          Checking the contract on Stellar…
        </div>
      )}
      {result?.kind === "found" && <FoundCard view={result.view} tokenOk={!!token && result.view.escrow.token === token} />}
      {result?.kind === "missing" && (
        <div aria-live="polite" className="popin flex items-center gap-3.5 rounded-card bg-error-bg px-6 py-5">
          <span className="display text-[22px] text-error">{padId(result.id)}</span>
          <span className="text-[15px] font-bold">No escrow with that number.</span>
        </div>
      )}
      {result?.kind === "invalid" && (
        <div id="q-invalid" role="alert" className="popin flex items-center gap-3.5 rounded-card bg-error-bg px-6 py-5 text-[15px]">
          <span>
            <strong className="text-error">That doesn&apos;t look like an escrow number.</strong> Try 42, #0042 or a Sisonke escrow link.
          </span>
        </div>
      )}
      {result?.kind === "error" && <ReadError reason={result.reason} onRetry={() => void search(result.id, false)} />}
    </main>
  );
}
