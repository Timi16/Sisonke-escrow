/** Every inline SVG from the design boards. All decorative (aria-hidden). */
type P = { size?: number; className?: string; color?: string };

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

export function CheckIcon({ size = 16, className, color = "currentColor", strokeWidth = 2.4 }: P & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 10.5l4 4 8-9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
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

export function ExternalIcon({ size = 12, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------- app shell (docs/design/app) */

export function HomeIcon({ size = 20, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 9.5L10 4l6.5 5.5V16a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}

export function ListIcon({ size = 20, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="4" width="14" height="5" rx="1.5" stroke={color} strokeWidth="1.9" />
      <rect x="3" y="11" width="14" height="5" rx="1.5" stroke={color} strokeWidth="1.9" />
    </svg>
  );
}

export function FindIcon({ size = 20, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="9" cy="9" r="5.5" stroke={color} strokeWidth="1.9" />
      <path d="M13.2 13.2L17 17" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function DropIcon({ size = 20, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.8s5 5.4 5 9.2a5 5 0 0 1-10 0c0-3.8 5-9.2 5-9.2z" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusBold({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 4v12M4 10h12" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function WalletIcon({ size = 20, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h8V7" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />
      <rect x="3.5" y="7" width="13" height="9.5" rx="2.5" stroke={color} strokeWidth="1.9" />
      <circle cx="13" cy="11.8" r="1.3" fill={color} />
    </svg>
  );
}

export function CopyIcon({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6.5A1.5 1.5 0 0 0 5.5 13H7" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

export function OpenIcon({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PowerIcon({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 3v7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M6 5.6a6 6 0 1 0 8 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CaretDown({ size = 16, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M5.5 8l4.5 4.5L14.5 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BackIcon({ size = 16, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M16 10H4.5M9 5.5L4.5 10 9 14.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowIcon({ size = 18, className, color = "currentColor" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5" stroke={color} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Spinner on ink: dark track, lime arc. */
export function InkSpinner({ size = 20, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className={`spin ${className ?? ""}`}>
      <circle cx="13" cy="13" r="10" stroke="var(--color-ink-line)" strokeWidth="3" fill="none" />
      <path d="M13 3 A10 10 0 0 1 23 13" stroke="var(--color-lime)" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Two rings sliding together and the lens popping in ("Connected", "is live"). */
export function JoinedRings({ width = 190, ring = "var(--color-ink)", lens = "var(--color-violet)", stroke = 4 }: { width?: number; ring?: string; lens?: string; stroke?: number }) {
  return (
    <svg width={width} height={(width * 120) / 180} viewBox="0 0 180 120" aria-hidden="true">
      <g className="in-l">
        <circle cx="66" cy="60" r="42" fill="none" stroke={ring} strokeWidth={stroke} />
      </g>
      <g className="in-r">
        <circle cx="114" cy="60" r="42" fill="none" stroke={ring} strokeWidth={stroke} />
      </g>
      <path className="lens" d="M90 25.53 A42 42 0 0 1 90 94.47 A42 42 0 0 1 90 25.53 Z" fill={lens} />
    </svg>
  );
}

/** A solid and a dashed ring drifting, a violet spark between: nothing here yet. */
export function DriftRings({ width = 120 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 200) / 320} viewBox="0 0 320 200" aria-hidden="true">
      <g className="drift-l">
        <circle cx="110" cy="100" r="78" fill="none" stroke="var(--color-ink)" strokeWidth="8" />
      </g>
      <g className="drift-r">
        <circle cx="210" cy="100" r="78" fill="none" stroke="var(--color-ink)" strokeWidth="8" strokeDasharray="16 14" />
      </g>
      <circle className="spark" cx="160" cy="100" r="12" fill="var(--color-violet)" />
    </svg>
  );
}
