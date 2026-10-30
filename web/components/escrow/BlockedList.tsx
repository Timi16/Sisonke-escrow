"use client";
import { useRef, useState } from "react";
import { signerOf, type ActionId, type Blocked } from "@/lib/sisonke/actions";
import { BLOCKED_LABEL } from "@/lib/sisonke/copy";
import { encode } from "@/lib/sisonke/contract";
import type { Escrow, Role } from "@/lib/sisonke/types";
import { ChevronDown, LockIcon, RefusedIcon, Spinner } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import { useTx } from "@/components/tx/TxProvider";

type Toast = { seq: number; body: string } | { seq: number; accepted: true };

/** Ends a refusal with "No money moved." without doubling our own "Nothing moved." */
function refusalBody(body: string): string {
  return `${body.replace(/\s*(Nothing moved\.|Nothing was sent\.)\s*$/, "")} No money moved.`;
}

function argsFor(id: ActionId, e: Escrow, me: string) {
  switch (id) {
    case "dispute":
      return encode.dispute(e.id, me);
    case "resolve":
      return encode.resolve(e.id, e.amount);
    default:
      return encode.id(e.id);
  }
}

const SIGNER_WORDS = { payer: "payer", recipient: "recipient", arbiter: "arbiter", party: "payer or the recipient" } as const;

/** The refusal toast, shown above the list. */
export function RefusalToast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  if ("accepted" in toast) {
    return (
      <Notice tone="info" role="status">
        The contract would accept this right now. Refreshing…
      </Notice>
    );
  }
  return (
    <div key={toast.seq} role="alert" className="shake flex items-start gap-3 rounded-note border-[1.5px] border-error bg-error-bg px-4 py-3.5">
      <RefusedIcon className="mt-px shrink-0" />
      <div className="flex flex-1 flex-col gap-1">
        <p className="m-0 text-[15px] font-bold text-error">Rejected by the contract</p>
        <p className="m-0 text-sm leading-normal text-ink">{toast.body}</p>
        <button type="button" onClick={onDismiss} className="min-h-11 self-start p-0 text-[13px] font-semibold underline underline-offset-4">
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** "Check other actions": each blocked action, why, and a Try anyway that only simulates. Collapsed by default. */
export function BlockedList({
  blocked,
  escrow,
  role,
  me,
  onAccepted,
}: {
  blocked: Blocked[];
  escrow: Escrow;
  role: Role;
  me: string;
  /** The probe succeeded: the view was stale, so refetch. */
  onAccepted: () => void;
}) {
  const tx = useTx();
  const [toast, setToast] = useState<Toast | null>(null);
  const [trying, setTrying] = useState<ActionId | null>(null);
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);

  if (!blocked.length) return null;

  const tryIt = async (b: Blocked) => {
    if (trying) return;
    setTrying(b.id);
    setToast(null);
    try {
      const out = await tx.probe(b.id, argsFor(b.id, escrow, me), escrow);
      const seq = ++seqRef.current;
      if (out.kind === "would-accept") {
        setToast({ seq, accepted: true });
        onAccepted();
        setTimeout(() => setToast((t) => (t && t.seq === seq ? null : t)), 4000);
        return;
      }
      const signer = signerOf(b.id);
      const wrongSigner = signer === "party" ? role !== "payer" && role !== "recipient" : role !== signer;
      const body =
        !out.enforced && wrongSigner
          ? `The contract checks the signature when a transaction is sent: only the ${SIGNER_WORDS[signer]} can do this.`
          : out.error.body;
      setToast({ seq, body: refusalBody(body) });
    } finally {
      setTrying(null);
    }
  };

  return (
    <section aria-labelledby="blocked-h" className="flex flex-col rounded-panel border border-line bg-card px-[22px] py-1.5">
      <h2 id="blocked-h" className="m-0 text-sm font-bold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="blocked-list"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-12 w-full items-center justify-between gap-3 border-0 bg-transparent p-0 text-left text-sm font-bold"
        >
          Check other actions
          <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      </h2>
      {open && (
        <div id="blocked-list" className="slidein flex flex-col gap-2 pb-3.5">
          {toast && <RefusalToast toast={toast} onDismiss={() => setToast(null)} />}
          <ul className="m-0 flex list-none flex-col p-0">
            {blocked.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-sand py-2.5">
                <div className="flex flex-[1_1_180px] flex-col gap-0.5">
                  <span className="inline-flex items-center gap-2 text-sm font-bold">
                    <LockIcon />
                    {BLOCKED_LABEL[b.id]}
                  </span>
                  <span className="text-[13px] leading-[1.45] text-muted">{b.why}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void tryIt(b)}
                  aria-disabled={!!trying || undefined}
                  aria-label={`Try anyway: ${BLOCKED_LABEL[b.id]}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border-[1.5px] border-dashed border-ink bg-transparent px-3.5 text-xs font-bold text-ink"
                >
                  {trying === b.id && <Spinner size={14} />}
                  Try anyway
                </button>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs leading-normal text-muted">Try anyway asks the contract on Testnet. Nothing is signed or sent.</p>
        </div>
      )}
    </section>
  );
}
