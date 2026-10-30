"use client";
import { cn } from "@/lib/cn";

/** An on/off switch (role="switch"), labelled by the element with `labelledBy`. */
export function Switch({ on, onChange, labelledBy, describedBy, disabled }: { on: boolean; onChange: (v: boolean) => void; labelledBy: string; describedBy?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onChange(!on)}
      className={cn("flex h-8 w-14 shrink-0 rounded-pill border-0 p-[3px]", on ? "bg-ink" : "bg-switch-off", disabled && "cursor-not-allowed opacity-60")}
    >
      <span className={cn("knob size-[26px] rounded-pill bg-card shadow-knob", on && "translate-x-6")} />
    </button>
  );
}
