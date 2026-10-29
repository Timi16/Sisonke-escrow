import Link from "next/link";
import { cn } from "@/lib/cn";

/** The two-ring mark with the violet lens. */
export function LogoMark({
  size = 26,
  ring = "var(--color-ink)",
  lens = "var(--color-violet)",
  stroke = 2.4,
  className,
}: {
  size?: number;
  ring?: string;
  lens?: string;
  stroke?: number;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true" className={className}>
      <circle cx="12" cy="17" r="9" fill="none" stroke={ring} strokeWidth={stroke} />
      <circle cx="22" cy="17" r="9" fill="none" stroke={ring} strokeWidth={stroke} />
      <path d="M17 9.52 A9 9 0 0 1 17 24.48 A9 9 0 0 1 17 9.52 Z" fill={lens} />
    </svg>
  );
}

/** Mark + "sisonke" wordmark, linking home. */
export function Logo({
  markSize = 26,
  textSize = 21,
  onInk = false,
  className,
}: {
  markSize?: number;
  textSize?: number;
  onInk?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="Sisonke home"
      className={cn("inline-flex items-center gap-2 no-underline", onInk ? "text-on-ink hover:text-on-ink" : "text-ink hover:text-ink", className)}
    >
      <LogoMark size={markSize} ring={onInk ? "var(--color-on-ink)" : "var(--color-ink)"} />
      <span className="font-bold tracking-[-0.03em]" style={{ fontSize: textSize }}>
        sisonke
      </span>
    </Link>
  );
}
