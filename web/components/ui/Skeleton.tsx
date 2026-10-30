import { cn } from "@/lib/cn";

/** Sand block in the shape of what's loading, on the website (Rules "About"). Static. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cn("block rounded-field bg-sand", className)} style={style} />;
}

/**
 * A placeholder block in the app. Static grey when there is nothing to load (no wallet),
 * shimmering while a read is in flight. Reduced motion stops the shimmer.
 */
export function Ph({ moving = false, ink = false, className, style }: { moving?: boolean; ink?: boolean; className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cn(ink ? (moving ? "shimmer-ink" : "ghost-ink") : moving ? "shimmer" : "ghost", className)} style={style} />;
}

/** "Couldn't reach Stellar" card with a retry. */
export function ReadError({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <section role="alert" className="flex flex-col gap-3 rounded-card border-2 border-ink bg-card p-[22px] shadow-action">
      <h2 className="m-0 font-serif text-2xl font-normal leading-none">Couldn&apos;t reach Stellar</h2>
      <p className="m-0 text-sm leading-normal text-muted">{reason}</p>
      <div>
        <button type="button" onClick={onRetry} className="min-h-11 rounded-pill border-[1.5px] border-ink bg-transparent px-5 text-sm font-bold">
          Try again
        </button>
      </div>
    </section>
  );
}
