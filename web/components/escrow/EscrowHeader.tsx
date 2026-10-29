"use client";
import Link from "next/link";
import { padId } from "@/lib/format";
import { displayTitle } from "@/lib/sisonke/title";
import type { EscrowView, Role } from "@/lib/sisonke/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { StatusChips } from "@/components/ui/StatusChip";

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LINK_LABEL: Partial<Record<Role, string>> = { payer: "Copy link for the recipient", recipient: "Copy link for the payer" };

/** Breadcrumb, h1, status chips (pop on change), the title as a quote, Copy link. */
export function EscrowHeader({ view, role }: { view: EscrowView; role: Role }) {
  const e = view.escrow;
  const id = e.id.toString();
  const title = displayTitle(e.title);
  return (
    <>
      <nav aria-label="Breadcrumb" className="rise hidden flex-wrap gap-2 text-sm font-semibold text-muted min-[720px]:flex" style={{ animationDelay: "40ms" }}>
        <Link href="/dashboard" className="text-muted">
          My escrows
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink" aria-current="page">
          Escrow {padId(id)}
        </span>
      </nav>
      <Link href="/dashboard" className="rise inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-muted no-underline min-[720px]:hidden">
        <BackIcon />
        My escrows
      </Link>
      <div className="rise flex flex-wrap items-end justify-between gap-x-8 gap-y-[18px]" style={{ animationDelay: "80ms" }}>
        <div className="flex min-w-0 flex-col gap-2 min-[720px]:gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5 min-[720px]:gap-3.5">
            <h1 className="display m-0 text-[38px] min-[720px]:text-[clamp(40px,4.6vw,64px)]">Escrow {padId(id)}</h1>
            <StatusChips status={e.status} deadlinePassed={view.deadlinePassed} size="header" pop />
          </div>
          {title.empty ? (
            <p className="m-0 font-serif text-[22px] leading-[1.2] text-muted min-[720px]:text-[26px]">Untitled escrow</p>
          ) : (
            <figure className="m-0 flex flex-col gap-1">
              <blockquote title={title.text} className="m-0 line-clamp-2 max-w-[760px] font-serif text-[22px] leading-[1.2] break-words min-[720px]:text-[26px]">
                “{title.text}”
              </blockquote>
              <figcaption className="text-[13px] text-muted">
                Note from the payer
                {title.stripped && <span> (hidden characters removed)</span>}
              </figcaption>
            </figure>
          )}
        </div>
        <CopyButton
          value={() => `${window.location.origin}/escrow/${id}`}
          label={LINK_LABEL[role] ?? "Copy link"}
          done="Link copied"
          variant="outline"
          className="!min-h-[46px] !px-5 !text-sm"
        />
      </div>
    </>
  );
}
