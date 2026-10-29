/** Every inline SVG from the design boards. All decorative (aria-hidden). */
type P = { size?: number; className?: string; color?: string };

export function SearchIcon({ size = 15, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="2" />
      <path d="M14 14l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDown({ size = 12, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className}>
      <path d="M3 5l4 4 4-4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRight({ size = 16, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M7 4l6 6-6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRight({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 10h12M11 5l5 5-5 5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className, color = "currentColor", strokeWidth = 2.4 }: P & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 10.5l4 4 8-9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Lime circle with an ink check: a finished step. */
export function DoneMark({ size = 26, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className={className}>
      <circle cx="14" cy="14" r="13" fill="var(--color-lime)" stroke="var(--color-ink)" strokeWidth="1.5" />
      <path d="M8.5 14.5l3.5 3.5 7.5-8" stroke="var(--color-ink)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Violet arc on a sand ring: something is running. */
export function Spinner({ size = 22, className, track = "var(--color-sand)" }: P & { track?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className={`spin ${className ?? ""}`}>
      <circle cx="13" cy="13" r="10" stroke={track} strokeWidth="3" fill="none" />
      <path d="M13 3 A10 10 0 0 1 23 13" stroke="var(--color-violet)" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M5 5l10 10M15 5L5 15" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function WarnIcon({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 3l10 18H2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="18" r="1" fill={color} />
    </svg>
  );
}

/** The "!" in the error circle. */
export function BangIcon({ size = 22, className, color = "var(--color-error)" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 7v6" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.4" fill={color} />
    </svg>
  );
}

/** Circle with a slash: refused. */
export function RefusedIcon({ size = 20, className, color = "var(--color-error)" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
      <path d="M6.5 17.5l11-11" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ size = 13, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="9" width="12" height="8" rx="2" stroke={color} strokeWidth="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function EyeIcon({ size = 14, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke={color} strokeWidth="1.8" />
      <circle cx="10" cy="10" r="2.5" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

export function ExternalIcon({ size = 12, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon({ size = 16, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3 6h14M3 10h14M3 14h14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ size = 14, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 4v12M4 10h12" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
