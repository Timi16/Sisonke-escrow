"use client";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { ChevronRight, ExternalIcon, JoinedRings, Spinner } from "@/components/ui/icons";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { WalletLogo } from "./WalletLogo";
import { useWallet, type ConnectReason } from "./WalletProvider";

const LINE: Record<ConnectReason, string> = {
  main: "Sisonke never sees your keys.",
  new: "Connect the wallet you’ll pay from.",
  escrows: "See every escrow you’re part of.",
  act: "Use the wallet that’s part of this escrow.",
  money: "Pick the wallet to fund.",
};

function Picker() {
  const { wallets, connecting, connectWith, connectError, connectReason, closeConnect } = useWallet();
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-start gap-3.5">
        <div className="flex flex-auto flex-col gap-1.5">
          <h2 id="connect-title" className="m-0 font-serif text-[25px] font-normal leading-none">
            Connect a wallet
          </h2>
          <p className="m-0 text-sm leading-normal text-muted">{LINE[connectReason]}</p>
        </div>
        <CloseButton onClick={closeConnect} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {wallets.map((w) => {
          const busy = connecting === w.id;
          const row = "flex min-h-[52px] w-full items-center gap-3.5 rounded-box border-[1.5px] border-line bg-card py-2.5 pr-4 pl-2.5 text-left text-ink no-underline";
          const name = (note: React.ReactNode) => (
            <span className="flex min-w-0 flex-auto flex-col gap-0.5">
              <span className="text-[15px] font-bold">{w.name}</span>
              <span className="text-[13px] text-muted">{note}</span>
            </span>
          );
          if (w.available === false) {
            return (
              <li key={w.id}>
                <a href={w.url} target="_blank" rel="noopener noreferrer" className={cn("wrow hover:text-ink", row)}>
                  <WalletLogo src={w.icon} size={44} framed />
                  {name("Not installed. Get it")}
                  <ExternalIcon size={14} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            );
          }
          return (
            <li key={w.id}>
              <button
                type="button"
                disabled={!!connecting}
                onClick={() => void connectWith(w.id)}
                className={cn("wrow", row, busy && "border-ink shadow-wallet-busy", !!connecting && !busy && "opacity-45", !!connecting && "cursor-wait")}
              >
                <WalletLogo src={w.icon} size={44} framed />
                {name(busy ? `Approve the request in ${w.name}…` : w.note)}
                {busy ? <Spinner size={22} track="var(--color-line)" /> : <ChevronRight size={16} />}
              </button>
            </li>
          );
        })}
      </ul>
      {connectError && (
        <p role="alert" className="slidein m-0 text-[13px] font-semibold text-error">
          {connectError}
        </p>
      )}
      <p className="m-0 border-t border-line pt-3.5 text-[13px] leading-normal text-muted">
        Only your public address is shared. No wallet?{" "}
        <a href="https://varialwallet.com" target="_blank" rel="noopener noreferrer" className="font-bold text-violet underline-offset-4">
          Get Varial
        </a>
      </p>
    </div>
  );
}

function Connected() {
  const { address, walletName, closeConnect } = useWallet();
  return (
    <div className="flex flex-col items-center gap-3.5 pt-2 pb-1 text-center">
      <JoinedRings width={190} />
      <h2 id="connect-title" className="display m-0 text-2xl">
        Connected
      </h2>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <span>{walletName ?? "Your wallet"}</span>
        {address && <span className="rounded-pill bg-ink px-2.5 py-1 font-mono text-[13px] text-on-ink">{shortAddress(address)}</span>}
      </div>
      <button type="button" onClick={closeConnect} className="display lift-app min-h-[52px] rounded-pill bg-lime px-[34px] text-lg text-ink">
        Continue
      </button>
    </div>
  );
}

/** The app's "Connect a wallet" dialog (replaces the kit's own picker). */
export function ConnectModal() {
  const { connectOpen, closeConnect, connectDone, address } = useWallet();
  return (
    <Modal open={connectOpen} onClose={closeConnect} labelledBy="connect-title">
      {connectDone && address ? <Connected /> : <Picker />}
    </Modal>
  );
}
