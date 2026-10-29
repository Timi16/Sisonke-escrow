import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BangIcon, WarnIcon } from "./icons";

/** Sand warning row with the triangle, or an error row. */
export function Notice({ children, tone = "warn", className, role }: { children: ReactNode; tone?: "warn" | "error" | "info"; className?: string; role?: "status" | "alert" }) {
  return (
    <div
      role={role}
      className={cn(
        "slidein flex items-start gap-3 rounded-note px-4 py-3.5 text-sm leading-normal",
        tone === "error" ? "border-[1.5px] border-error bg-error-bg text-ink" : "bg-sand text-ink",
        className,
      )}
    >
      {tone === "error" ? (
        <BangIcon size={18} className="mt-px shrink-0" />
      ) : tone === "warn" ? (
        <WarnIcon size={18} className="mt-px shrink-0" />
      ) : (
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill border-[1.5px] border-ink" />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
