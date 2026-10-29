import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Label({ htmlFor, children, optional, className }: { htmlFor?: string; children: ReactNode; optional?: boolean; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("flex items-center gap-2 text-[15px] font-bold", className)}>
      {children}
      {optional && <span className="rounded-pill bg-sand px-2.5 py-0.5 text-xs font-semibold text-muted">Optional</span>}
    </label>
  );
}

export const inputClass = (invalid?: boolean) =>
  cn(
    "w-full min-h-[54px] rounded-field border-[1.5px] bg-ground px-4 text-base text-ink outline-none transition-colors",
    "focus:border-violet disabled:cursor-not-allowed disabled:opacity-60",
    invalid ? "border-error" : "border-line-strong",
  );

type InputProps = ComponentProps<"input"> & { invalid?: boolean };

export function Input({ invalid, className, ...rest }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={cn(inputClass(invalid), className)} {...rest} />;
}

/** Anton 30px amount with a "USDC" suffix. */
export function AmountInput({ invalid, className, suffix = "USDC", ...rest }: InputProps & { suffix?: string }) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className={cn(inputClass(invalid), "display tabular min-h-16 pr-20 text-[30px]")}
        {...rest}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-4 text-[15px] font-bold text-muted">
        {suffix}
      </span>
    </div>
  );
}

export function Hint({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("m-0 text-[13px] leading-normal text-muted", className)}>
      {children}
    </p>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="slidein m-0 text-[13px] font-semibold leading-normal text-error">
      {children}
    </p>
  );
}
