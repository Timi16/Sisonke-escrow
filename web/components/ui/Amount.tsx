import { cn } from "@/lib/cn";
import { formatUsdc } from "@/lib/sisonke/amount";

/** Anton tabular figure + "USDC". */
export function Amount({ stroops, size = 30, unit = true, className }: { stroops: bigint; size?: number; unit?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap", className)}>
      <span className="display tabular" style={{ fontSize: size }}>
        {formatUsdc(stroops)}
      </span>
      {unit && <span className="text-[13px] font-bold">USDC</span>}
    </span>
  );
}
