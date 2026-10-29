"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseEscrowQuery } from "@/lib/api";
import { padId, shortAddress } from "@/lib/format";
import { useInfo } from "@/lib/hooks/queries";
import { formatUsdc } from "@/lib/sisonke/amount";
import { getEscrow } from "@/lib/sisonke/reads";
import { statusSentence } from "@/lib/sisonke/status";
import { displayTitle } from "@/lib/sisonke/title";
import type { EscrowView } from "@/lib/sisonke/types";
import { NotFoundCard } from "@/components/escrow/MissingEscrow";
import { CopyButton } from "@/components/ui/CopyButton";
import { Spinner } from "@/components/ui/icons";
import { ReadError } from "@/components/ui/Skeleton";
import { StatusChips } from "@/components/ui/StatusChip";
import { toSisonkeError } from "@/lib/sisonke/errors";

type Result =
  | { kind: "searching"; id: string }
  | { kind: "found"; id: string; view: EscrowView }
  | { kind: "missing"; id: string }
  | { kind: "invalid" }
  | { kind: "error"; id: string; reason: string };

function FoundCard({ view, tokenOk }: { view: EscrowView; tokenOk: boolean }) {
  const e = view.escrow;
  const t = displayTitle(e.title);
  return (
    <article aria-live="polite" className="slide-up flex flex-col gap-[22px] rounded-panel border-[1.5px] border-ink bg-card p-7 shadow-action">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[13px] text-muted">{padId(e.id)}</span>
          <h2 className="m-0 line-clamp-2 font-serif text-4xl font-normal leading-none" title={t.text}>
            {t.empty ? <span className="text-muted">Untitled escrow</span> : t.text}
            {t.stripped && <span className="ml-2 font-sans text-[13px] text-muted">(hidden characters removed)</span>}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChips status={e.status} deadlinePassed={view.deadlinePassed} size="row" />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2.5">
        {(
          [
            ["Payer", e.payer],
            ["Recipient", e.recipient],
          ] as const
        ).map(([label, addr]) => (
          <div key={label} className="flex flex-col gap-1 rounded-box bg-ground p-4">
            <span className="text-[13px] text-muted">{label}</span>
            <span className="font-mono text-[15px] font-semibold" title={addr}>
              {shortAddress(addr)}
            </span>
            <CopyButton value={addr} ariaLabel={`Copy the ${label.toLowerCase()}'s address`} className="self-start" />
          </div>
        ))}
        <div className="flex flex-col gap-1 rounded-box bg-ground p-4">
          <span className="text-[13px] text-muted">Amount</span>
          {tokenOk ? (
            <>
              <span className="display tabular text-[28px]">{formatUsdc(e.amount)}</span>
              <span className="text-xs font-semibold text-muted">USDC</span>
            </>
          ) : (
            <span className="text-[15px] font-semibold">Unknown token, amount hidden</span>
          )}
        </div>
      </div>
      {tokenOk && <p className="m-0 text-[15px] leading-[1.55] text-muted">{statusSentence(view)}</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          href={`/escrow/${e.id.toString()}`}
          className="display lift inline-flex min-h-[54px] items-center rounded-pill bg-ink px-[26px] text-xl text-on-ink no-underline hover:text-on-ink"
        >
          Open escrow
        </Link>
        <span className="text-sm text-muted">Viewing doesn&apos;t need a wallet. Acting does.</span>
      </div>
    </article>
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

  const picks =
    count && count > 0n
      ? [count, count - 1n, count - 2n].filter((x) => x >= 1n).map((x) => x.toString())
      : [];

  return (
    <main id="main" className="mx-auto flex max-w-[980px] flex-col gap-8 px-4 pt-14 pb-24 min-[720px]:px-6">
      <div className="rise flex flex-col items-start gap-[18px]" style={{ animationDelay: "60ms" }}>
        <h1 className="display m-0 flex flex-col items-start leading-[0.95]">
          <span className="inline-block bg-ink px-5 pt-3 pb-4 text-[clamp(40px,5vw,68px)] text-on-ink">Find an escrow.</span>
        </h1>
        <p className="m-0 max-w-[24em] font-serif text-[clamp(24px,2.6vw,32px)] leading-[1.2]">
          Got an ID or a link? Anyone can check an escrow. Only the two people in it can move the money.
        </p>
      </div>

      <form
        className="rise flex flex-col gap-3.5 rounded-panel border border-line bg-card p-[26px]"
        style={{ animationDelay: "120ms" }}
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <label htmlFor="q" className="text-base font-bold">
          Escrow ID or link
        </label>
        <div className="flex flex-wrap gap-2.5">
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 42"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={result?.kind === "invalid" || undefined}
            aria-describedby={result?.kind === "invalid" ? "q-invalid" : undefined}
            className="min-h-[60px] min-w-0 flex-[1_1_260px] rounded-note border-[1.5px] border-line-strong bg-ground px-[18px] text-xl font-semibold text-ink outline-none focus:border-violet"
          />
          <button type="submit" className="display lift min-h-[60px] flex-none rounded-pill border-[1.5px] border-ink bg-lime px-[30px] text-[22px] text-ink">
            Find it
          </button>
        </div>
        {picks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">Try one:</span>
            {picks.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setQuery(padId(p));
                  void search(p);
                }}
                className="min-h-11 rounded-pill border-[1.5px] border-line-strong bg-transparent px-3.5 font-mono text-[13px] text-ink hover:border-ink"
              >
                {padId(p)}
              </button>
            ))}
          </div>
        )}
      </form>

      {result?.kind === "searching" && (
        <div aria-live="polite" className="slidein flex items-center gap-3.5 rounded-[24px] bg-sand px-[26px] py-[22px] text-base font-semibold">
          <Spinner track="var(--color-line-strong)" />
          Checking the contract on Stellar…
        </div>
      )}
      {result?.kind === "found" && <FoundCard view={result.view} tokenOk={!!token && result.view.escrow.token === token} />}
      {result?.kind === "missing" && <NotFoundCard id={result.id} />}
      {result?.kind === "invalid" && (
        <div id="q-invalid" role="alert" className="slidein rounded-menu border-[1.5px] border-error bg-error-bg px-[22px] py-[18px] text-[15px] leading-normal">
          <strong className="text-error">That doesn&apos;t look like an escrow ID.</strong> IDs are numbers, like 42, or a Sisonke escrow link.
        </div>
      )}
      {result?.kind === "error" && <ReadError reason={result.reason} onRetry={() => void search(result.id, false)} />}
    </main>
  );
}
