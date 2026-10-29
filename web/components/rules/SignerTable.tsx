import { StatusChip } from "@/components/ui/StatusChip";
import type { Status } from "@/lib/sisonke/types";

export interface SignerRow {
  action: string;
  who: string;
  when: string;
  moves: string;
  after: Status[] | null;
}

/** The complete signer table (WEB_PLAN §3.7, CONTRACT.md "Who may do what"). */
export const SIGNER_ROWS: SignerRow[] = [
  {
    action: "Create",
    who: "Payer",
    when: "Amount above zero, recipient isn’t the payer, deadline in the future and within 365 days",
    moves: "Nothing yet",
    after: ["Created"],
  },
  { action: "Deposit", who: "Payer", when: "Awaiting deposit, before the deadline, not paused", moves: "Payer to contract", after: ["Funded"] },
  { action: "Cancel", who: "Payer", when: "Awaiting deposit, any time", moves: "Nothing", after: ["Cancelled"] },
  { action: "Release", who: "Payer only", when: "Funded or in dispute", moves: "Contract to recipient, full amount", after: ["Released"] },
  { action: "Refund", who: "Recipient only", when: "Funded or in dispute", moves: "Contract to payer, full amount", after: ["Refunded"] },
  { action: "Reclaim", who: "Payer only", when: "Funded, deadline passed, no dispute", moves: "Contract to payer, full amount", after: ["Refunded"] },
  { action: "Dispute", who: "Payer or recipient", when: "Funded, before the deadline, arbiter named", moves: "Nothing", after: ["Disputed"] },
  {
    action: "Resolve",
    who: "Arbiter only",
    when: "In dispute",
    moves: "Split as the arbiter decides",
    after: ["Released", "Refunded", "Split"],
  },
  { action: "View", who: "Anyone", when: "Always", moves: "Nothing", after: null },
];

const cell = "border-b border-line-strong px-5 py-[18px] align-top";

export function SignerTable() {
  return (
    <section id="who" className="px-3 min-[720px]:px-8">
      <div className="rise-lg mx-auto flex max-w-[1376px] flex-col gap-8 rounded-panel bg-ink px-[clamp(20px,4vw,72px)] py-[clamp(36px,5vw,80px)] text-on-ink min-[720px]:rounded-section">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="flex flex-col gap-4">
            <span className="inline-flex min-h-9 items-center self-start rounded-pill border-[1.5px] border-on-ink px-4 text-[15px] font-semibold">
              Who can do what
            </span>
            <h2 className="m-0 max-w-[16ch] font-serif text-[clamp(38px,4.4vw,60px)] leading-[1.02] font-normal">
              One signature, from one specific person.
            </h2>
          </div>
          <p className="m-0 max-w-[28em] text-[17px] leading-[1.6] text-on-ink-muted">Nobody else’s signature counts. Not a stranger’s, not ours.</p>
        </div>
        <div className="relative overflow-x-auto rounded-[24px] bg-ground text-ink" tabIndex={0} role="region" aria-label="Who can do what (scrolls sideways)">
          <table className="w-full min-w-[860px] border-collapse text-[15px] leading-normal">
            <thead>
              <tr className="text-left">
                {["Action", "Who signs", "Allowed when", "Money moves", "Status after"].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`border-b-[1.5px] border-ink px-5 pt-5 pb-3.5 text-[13px] font-bold text-muted ${i === 0 ? "pl-[26px]" : ""} ${i === 4 ? "pr-[26px]" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SIGNER_ROWS.map((r, i) => {
                const last = i === SIGNER_ROWS.length - 1;
                const c = last ? cell.replace("border-b border-line-strong", "") : cell;
                return (
                  <tr key={r.action}>
                    <th scope="row" className={`${c} pl-[26px] text-left text-base font-bold`}>
                      {r.action}
                    </th>
                    <td className={c}>{r.who}</td>
                    <td className={`${c} text-muted`}>{r.when}</td>
                    <td className={`${c} text-muted`}>{r.moves}</td>
                    <td className={`${c} pr-[26px]`}>
                      {r.after ? (
                        <span className="flex flex-wrap gap-1.5">
                          {r.after.map((s) => (
                            <StatusChip key={s} status={s} size="compact" />
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted">No change</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
