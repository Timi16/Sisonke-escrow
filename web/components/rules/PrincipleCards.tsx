"use client";
import { deployment } from "@/lib/generated/deployment";
import { duration } from "@/lib/format";
import { useInfo } from "@/lib/hooks/queries";

/** "No back door" (corrected per WEB_PLAN §11), "Status follows the chain", "Why the payer can reclaim". */
export function PrincipleCards() {
  const info = useInfo().data?.info;
  const notice = duration(info?.upgradeDelay ?? Number(deployment.SISONKE_UPGRADE_DELAY));
  return (
    <div className="rise-lg flex min-w-0 flex-[1_1_340px] flex-col gap-4" style={{ animationDelay: "120ms" }}>
      <div className="lift-rules flex flex-col gap-3 rounded-panel border-[1.5px] border-ink bg-lime p-[30px]">
        <h3 className="display m-0 text-[34px]">No back door</h3>
        <p className="m-0 text-base leading-[1.6]">
          No admin function can move, freeze or redirect money in an escrow.{" "}
          {info?.upgradesLocked
            ? "The code is final: upgrades are locked for good."
            : `The code can be upgraded only after a public notice period of ${notice}, and every page warns you while an upgrade is pending, so you can settle first.`}{" "}
          The website holds no keys. If it disappeared tomorrow, every escrow would still work from Stellar Lab.
        </p>
      </div>
      <div className="lift-rules flex flex-col gap-2.5 rounded-panel border border-line bg-card p-[26px]">
        <h3 className="m-0 text-lg font-bold">Status follows the chain</h3>
        <p className="m-0 text-[15px] leading-[1.6] text-muted">
          The app changes status only after Stellar confirms. If a transaction fails, the escrow stays exactly as it was and the app says why.
        </p>
      </div>
      <div className="lift-rules flex flex-col gap-2.5 rounded-panel border border-line bg-card p-[26px]">
        <h3 className="m-0 text-lg font-bold">Why the payer can reclaim</h3>
        <p className="m-0 text-[15px] leading-[1.6] text-muted">
          It’s the one time someone can send money to themselves. Without it, money would be stuck forever if the recipient vanished. It
          only works after the deadline both people saw at the start, if no dispute was opened before it.
        </p>
      </div>
    </div>
  );
}
