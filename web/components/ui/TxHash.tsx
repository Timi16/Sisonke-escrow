import { cn } from "@/lib/cn";
import { explorer } from "@/lib/config";
import { shortHash } from "@/lib/format";

/** Short mono violet link to the transaction on Stellar Expert. */
export function TxHash({ hash, full = false, className }: { hash: string; full?: boolean; className?: string }) {
  let href: string;
  try {
    href = explorer.tx(hash);
  } catch {
    return <span className="font-mono text-[13px] text-muted">{shortHash(hash)}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open transaction ${hash} on Stellar Expert`}
      className={cn("font-mono text-[13px] text-violet hover:text-violet", full && "break-all", className)}
    >
      {full ? hash : shortHash(hash)}
    </a>
  );
}
