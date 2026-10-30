import type { ReactNode } from "react";

/** The page title row: serif h1, an optional line under it, an optional action on the right. */
export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <section className="rise flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1 pt-1" style={{ animationDelay: "60ms" }}>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-serif text-[clamp(28px,2.6vw,31px)] font-normal leading-none tracking-[-0.02em]">{title}</h1>
        {sub && <p className="m-0 text-[15px] text-muted">{sub}</p>}
      </div>
      {action}
    </section>
  );
}
