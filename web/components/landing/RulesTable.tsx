import Link from "next/link";
import { SIGNER_ROWS } from "@/components/rules/SignerTable";

/** The landing's three-column rules table, with every row of the full signer table (WEB_PLAN §11). */
export function RulesTable() {
  return (
    <section id="rules" className="mx-auto grid max-w-[1240px] grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] items-start gap-x-20 gap-y-12 px-[18px] py-16 min-[720px]:px-8 min-[720px]:py-32">
      <div className="flex flex-col gap-5 min-[720px]:sticky min-[720px]:top-8">
        <h2 className="m-0 font-serif text-[38px] leading-[1.02] font-normal tracking-[-0.02em] min-[720px]:text-[clamp(42px,4.6vw,64px)]">
          The rules live in the contract, not on our servers.
        </h2>
        <p className="m-0 max-w-[30em] text-lg leading-[1.6] text-muted">
          If it isn’t in this table, the contract says no. Once an escrow is Released, Refunded, Split or Cancelled it’s closed for good,
          so nothing pays out twice.
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-7">
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Rules table (scrolls sideways)">
          <table className="w-full border-collapse text-[15px] min-[720px]:min-w-[440px] min-[720px]:text-base">
            <thead>
              <tr className="text-left">
                <th scope="col" className="border-b-[1.5px] border-ink pr-4 pb-3.5 text-sm font-semibold text-muted">
                  Action
                </th>
                <th scope="col" className="border-b-[1.5px] border-ink px-4 pb-3.5 text-sm font-semibold text-muted">
                  Who signs
                </th>
                <th scope="col" className="border-b-[1.5px] border-ink pb-3.5 pl-4 text-sm font-semibold text-muted">
                  Allowed when
                </th>
              </tr>
            </thead>
            <tbody>
              {SIGNER_ROWS.map((r, i) => {
                const b = i === SIGNER_ROWS.length - 1 ? "" : "border-b border-line-strong";
                return (
                  <tr key={r.action} className="align-top">
                    <th scope="row" className={`${b} py-[18px] pr-4 text-left font-bold`}>
                      {r.action}
                    </th>
                    <td className={`${b} px-4 py-[18px]`}>{r.who}</td>
                    <td className={`${b} py-[18px] pl-4 text-muted`}>{r.when}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Link href="/rules" className="self-start text-[17px] font-semibold underline decoration-2 underline-offset-[6px]">
          Read the full rules and proof
        </Link>
      </div>
    </section>
  );
}
