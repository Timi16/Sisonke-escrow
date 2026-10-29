"use client";

/** Backstop if a screen throws while rendering: plain words and a retry, never the raw error. */
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
      <h1 className="font-serif text-4xl">Something went wrong on this page.</h1>
      <p className="text-muted">Nothing was signed or sent. Your money stays where the contract holds it.</p>
      <button type="button" onClick={() => retry()} className="rounded-pill bg-ink px-6 py-3 font-bold text-on-ink">
        Try again
      </button>
    </main>
  );
}
