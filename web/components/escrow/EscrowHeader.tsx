"use client";
import Link from "next/link";
import { padId } from "@/lib/format";
import { displayTitle } from "@/lib/sisonke/title";
import type { EscrowView, Role } from "@/lib/sisonke/types";
import { AppChips } from "@/components/ui/AppChip";
import { CopyButton } from "@/components/ui/CopyButton";
import { BackIcon } from "@/components/ui/icons";

const LINK_LABEL: Partial<Record<Role, string>> = { payer: "Copy link for the recipient", recipient: "Copy link for the payer" };

export function BackLink() {
  return (
    <Link href="/escrows" className="inline-flex min-h-10 items-center gap-2 self-start text-sm font-bold text-muted no-underline">
      <BackIcon />
      Escrows
    </Link>
  );
}

/** "ESCROW #0042", the status chip (pops on change), the title in serif quotes, Copy link. */
export function EscrowHeader({ view, role }: { view: EscrowView; role: Role }) {
  const e = view.escrow;
  const id = e.id.toString();
  const title = displayTitle(e.title);
  return (
    <section className="rise flex flex-wrap items-end justify-between gap-x-6 gap-y-3.5">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="display m-0 text-[clamp(26px,3.6vw,43px)] leading-[0.95]">Escrow {padId(id)}</h1>
          <span className="flex flex-wrap gap-1.5">
            <AppChips status={e.status} deadlinePassed={view.deadlinePassed} big pop />
          </span>
        </div>
        {title.empty ? (
          <p className="m-0 font-serif text-[21px] leading-[1.1] text-muted">Untitled escrow</p>
        ) : (
          <p title={title.text} className="m-0 line-clamp-2 max-w-[760px] font-serif text-[21px] leading-[1.1] break-words">
            “{title.text}”{title.stripped && <span className="ml-2 font-sans text-[13px] text-muted">(hidden characters removed)</span>}
          </p>
        )}
      </div>
      <CopyButton
        value={() => `${window.location.origin}/escrow/${id}`}
        label={LINK_LABEL[role] ?? "Copy link"}
        done="Link copied"
        variant="outline"
        className="!min-h-12 !bg-transparent !px-5 !text-sm"
      />
    </section>
  );
}
