import { cn } from "@/lib/cn";

/** Sand block in the shape of what's loading. Static (no shimmer), so nothing moves under reduced motion. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cn("block rounded-field bg-sand", className)} style={style} />;
}

/** "Couldn't reach Stellar" card with a retry. */
export function ReadError({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <section role="alert" className="flex flex-col gap-3.5 rounded-card border-[1.5px] border-ink bg-card p-[26px] shadow-action">
      <h2 className="m-0 font-serif text-[32px] font-normal leading-[1.05]">Couldn&apos;t reach Stellar</h2>
      <p className="m-0 text-[15px] leading-[1.55] text-muted">{reason}</p>
      <div>
        <button type="button" onClick={onRetry} className="min-h-12 rounded-pill border-[1.5px] border-ink bg-transparent px-5 text-[15px] font-bold">
          Try again
        </button>
      </div>
    </section>
  );
}
