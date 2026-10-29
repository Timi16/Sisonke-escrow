"use client";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { WalletPicker } from "@/components/setup/WalletPicker";
import { useWallet } from "./WalletProvider";

/** The design's "Connect a wallet" modal (replaces the kit's own picker). */
export function ConnectModal() {
  const { connectOpen, closeConnect } = useWallet();
  return (
    <Modal open={connectOpen} onClose={closeConnect} labelledBy="connect-title">
      <div className="flex flex-col gap-1.5 pr-14">
        <h2 id="connect-title" className="m-0 font-serif text-[34px] font-normal leading-none">
          Connect a wallet
        </h2>
        <p className="m-0 text-sm leading-normal text-muted">Sisonke never sees your keys. You approve every step in your wallet.</p>
      </div>
      <WalletPicker />
      <p className="m-0 text-sm text-muted">
        New to Stellar?{" "}
        <Link href="/setup" onClick={closeConnect} className="font-bold underline-offset-4">
          Set up in four steps
        </Link>
      </p>
    </Modal>
  );
}
