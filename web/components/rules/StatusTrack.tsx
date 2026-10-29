import { StatusChip } from "@/components/ui/StatusChip";

function Link_({ delay }: { delay?: string }) {
  return (
    <span aria-hidden="true" className="relative flex h-2.5 w-14 items-center">
      <span className="mx-1.5 h-0.5 flex-1 bg-ink" />
      <span className="travel absolute top-px left-0 size-2 rounded-pill bg-violet" style={delay ? { animationDelay: delay } : undefined} />
    </span>
  );
}

/** Awaiting deposit → Funded → Released or Refunded, plus the arbiter and cancel paths (WEB_PLAN §3.7). */
export function StatusTrack() {
  return (
    <div className="flex flex-col gap-3">
      <div className="rise-lg flex flex-wrap items-center gap-y-2.5" style={{ animationDelay: "220ms" }} aria-label="How the status moves" role="group">
        <StatusChip status="Created" size="header" />
        <Link_ />
        <StatusChip status="Funded" size="header" />
        <Link_ delay="1.1s" />
        <StatusChip status="Released" size="header" />
        <span className="px-3 text-[15px] font-semibold text-muted">or</span>
        <StatusChip status="Refunded" size="header" />
      </div>
      <p className="rise-lg m-0 text-[15px] leading-normal text-muted" style={{ animationDelay: "260ms" }}>
        With an arbiter: Funded → In dispute → Released, Refunded or Split. Unfunded escrows can be Cancelled.
      </p>
      <p className="rise-lg m-0 text-[15px] text-muted" style={{ animationDelay: "300ms" }}>
        Status only moves forward. Released, Refunded, Split and Cancelled are final.
      </p>
    </div>
  );
}
