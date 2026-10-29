"use client";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * White pill track with a sliding ink thumb (Dashboard board): equal columns,
 * the thumb slides by whole columns. Arrow keys move between tabs.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix = "tab",
  controls,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idPrefix?: string;
  /** Id of the tab panel. */
  controls?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, tabs.findIndex((t) => t.value === value));
  const n = Math.max(1, tabs.length);

  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className="relative grid rounded-pill border border-line bg-card p-[5px]"
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, width: `min(${n * 210}px, 100%)` }}
    >
      <span
        aria-hidden="true"
        className="tabs-thumb absolute top-[5px] bottom-[5px] left-[5px] rounded-pill bg-ink"
        style={{ width: `calc((100% - 10px) / ${n})`, transform: `translateX(${index * 100}%)` }}
      />
      {tabs.map((t, i) => {
        const on = i === index;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idPrefix}-${t.value}`}
            role="tab"
            type="button"
            aria-selected={on}
            aria-controls={controls}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative z-[1] min-h-[46px] rounded-pill border-0 bg-transparent px-3 text-[15px] font-bold transition-colors duration-300",
              on ? "text-on-ink" : "text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tabular ml-1 font-semibold opacity-70">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
