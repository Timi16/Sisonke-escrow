"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { buttonClass, type Size, type Variant } from "./Button";

/** "Copy" → "Copied" for 1.6 s. Only ever copies the app's own strings. */
export function CopyButton({
  value,
  label = "Copy",
  done = "Copied",
  variant = "ghost",
  size = "md",
  className,
  ariaLabel,
}: {
  value: string | (() => string);
  label?: string;
  done?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(typeof value === "function" ? value() : value);
        } catch {
          /* clipboard blocked: the label still confirms the click */
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
      className={cn(buttonClass(variant, size), className)}
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
