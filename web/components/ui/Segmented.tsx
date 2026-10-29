"use client";
import { cn } from "@/lib/cn";

/** Pill toggles (deadline presets, filters, quick splits). aria-pressed on each. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-disabled={disabled || undefined}
            onClick={() => !disabled && onChange(o.value)}
            className={cn(
              "min-h-10 rounded-pill border-[1.5px] px-4 text-sm font-bold transition-colors",
              on ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-transparent text-ink hover:border-ink",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
