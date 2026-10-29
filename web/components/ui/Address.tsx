"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { explorer } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { CopyButton } from "./CopyButton";

/** Short mono address, the full value on demand, Copy and an Explorer link. */
export function Address({
  address,
  full = false,
  expandable = false,
  copy = true,
  link = true,
  className,
  kind = "account",
}: {
  address: string;
  /** Always show the full value (wrapping). */
  full?: boolean;
  expandable?: boolean;
  copy?: boolean;
  link?: boolean;
  className?: string;
  kind?: "account" | "contract";
}) {
  const [open, setOpen] = useState(false);
  let href: string | null = null;
  try {
    href = kind === "contract" ? explorer.contract(address) : explorer.account(address);
  } catch {
    href = null;
  }
  const showFull = full || open;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3", className)}>
      <span title={address} className={cn("font-mono text-sm", showFull && "break-all")}>
        {showFull ? address : shortAddress(address)}
      </span>
      {expandable && !full && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-11 px-0.5 text-[13px] font-bold text-violet">
          {open ? "Hide full" : "Show full"}
        </button>
      )}
      {copy && <CopyButton value={address} ariaLabel={`Copy ${address}`} />}
      {link && href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-bold text-violet">
          Explorer
        </a>
      )}
    </span>
  );
}
