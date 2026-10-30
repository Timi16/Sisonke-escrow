"use client";

/** Backstop if a screen throws while rendering: plain words and a retry, never the raw error. */
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" className="flex max-w-xl flex-col items-start gap-4 py-16">
      <h1 className="m-0 font-serif text-[31px] font-normal leading-none">Something went wrong on this page.</h1>
      <p className="m-0 text-sm text-muted">Nothing was signed or sent. Your money stays where the contract holds it.</p>
      <button type="button" onClick={() => retry()} className="min-h-12 rounded-pill bg-ink px-6 text-sm font-extrabold text-on-ink">
        Try again
      </button>
    </main>
  );
}
