import { cn } from "@/lib/cn";
import { formatDayName } from "@/lib/format";
import type { Escrow, Role } from "@/lib/sisonke/types";

type Who = "payer" | "recipient" | "arbiter" | "both" | "none";

/** "Who can do what" for this escrow, with the viewer's rows highlighted. */
export function WhoCan({ escrow: e, role }: { escrow: Escrow; role: Role }) {
  const day = formatDayName(e.deadline);
  const rows: [string, string, Who][] = [
    ...(e.status === "Created" ? ([["Deposit or cancel", "Payer", "payer"]] as [string, string, Who][]) : []),
    ["Release", "Payer", "payer"],
    ["Refund", "Recipient", "recipient"],
    e.arbiter ? ["Open a dispute", `Either, before ${day}`, "both"] : ["Open a dispute", "Nobody: no arbiter", "none"],
    ...(e.arbiter ? ([["Decide a dispute", "Arbiter", "arbiter"]] as [string, string, Who][]) : []),
    ["Reclaim", `Payer, after ${day}`, "payer"],
  ];
  const mine = (w: Who) => w === role || (w === "both" && (role === "payer" || role === "recipient"));
  return (
    <section aria-labelledby="who-h" className="rise flex flex-col gap-2.5 rounded-panel bg-sand p-[22px]" style={{ animationDelay: "180ms" }}>
      <h2 id="who-h" className="m-0 text-[15px] font-extrabold">
        Who can do what
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map(([act, who, w]) => (
          <li key={act} className="flex items-baseline justify-between gap-3 border-t border-line-strong py-2.5 text-sm">
            <span className="font-bold">{act}</span>
            <span className={cn("text-right", mine(w) ? "font-bold text-violet" : "text-muted")}>
              {who}
              {mine(w) && " · you"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
