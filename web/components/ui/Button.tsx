import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Variant = "primary" | "lime" | "ink" | "outline" | "ghost" | "dashed" | "on-ink-outline" | "on-ink-primary";
export type Size = "sm" | "md" | "lg" | "xl" | "section";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-pill text-center no-underline select-none disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const VARIANT: Record<Variant, string> = {
  primary: "display border-[1.5px] border-ink bg-lime text-ink hover:text-ink lift",
  lime: "border-[1.5px] border-ink bg-lime font-bold text-ink hover:text-ink lift",
  ink: "border-0 bg-ink font-bold text-on-ink hover:text-on-ink",
  outline: "border-[1.5px] border-ink bg-card font-bold text-ink hover:text-ink lift",
  ghost: "border-0 bg-transparent px-0.5 text-[13px] font-bold text-violet hover:text-violet",
  dashed: "border-[1.5px] border-dashed border-ink bg-transparent px-3.5 text-xs font-bold text-ink",
  "on-ink-outline": "border-[1.5px] border-ink-btn-line bg-transparent font-bold text-on-ink hover:text-on-ink",
  "on-ink-primary": "display border-[1.5px] border-ink bg-lime text-ink hover:text-ink lift",
};

const SIZE: Record<Size, string> = {
  sm: "min-h-10 px-4 text-sm",
  md: "min-h-12 px-[22px] text-[15px]",
  lg: "min-h-[58px] w-full px-6 text-[21px]",
  xl: "min-h-16 px-[34px] text-2xl shadow-cta-ring cta",
  section: "min-h-[60px] px-[30px] text-[22px] cta",
};

/** Ghost and dashed buttons keep a 44px tap target without padding. */
const TAP: Partial<Record<Variant, string>> = { ghost: "min-h-11", dashed: "min-h-11" };

const DISABLED_LIGHT = "!bg-sand !text-faint !border-line-strong hover:!translate-y-0 hover:!shadow-none";
const DISABLED_INK = "!bg-ink-3 !text-faint !border-ink-3 hover:!translate-y-0 hover:!shadow-none";

export function buttonClass(variant: Variant = "outline", size: Size = "md", disabled = false, className?: string) {
  const onInk = variant === "on-ink-outline" || variant === "on-ink-primary";
  return cn(
    BASE,
    VARIANT[variant],
    TAP[variant] ?? SIZE[size],
    disabled && (onInk ? DISABLED_INK : DISABLED_LIGHT),
    className,
  );
}

type ButtonProps = Omit<ComponentProps<"button">, "disabled"> & {
  variant?: Variant;
  size?: Size;
  /** Disabled with aria-disabled, so it stays focusable and its reason can be read. */
  disabled?: boolean;
};

export function Button({ variant = "outline", size = "md", disabled = false, className, onClick, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (e) => e.preventDefault() : onClick}
      className={buttonClass(variant, size, disabled, className)}
      {...rest}
    />
  );
}

type LinkProps = {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  /** External links open in a new tab. */
  external?: boolean;
};

export function ButtonLink({ href, variant = "outline", size = "md", className, children, external, ...rest }: LinkProps) {
  const cls = buttonClass(variant, size, false, className);
  if (external || /^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

/** A plain external text link: new tab, no opener, no referrer. */
export function ExternalLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode; "aria-label"?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
      {children}
    </a>
  );
}
