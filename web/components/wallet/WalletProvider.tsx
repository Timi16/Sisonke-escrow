"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ISupportedWallet, StellarWalletsKit as Kit } from "@creit.tech/stellar-wallets-kit";
import { config } from "@/lib/config";
import type { SignFn } from "@/lib/stellar/tx";
import { ConnectModal } from "./ConnectModal";

type KitClass = typeof Kit;

/** The wallets offered, in order (WEB_PLAN §7). Ids match the kit's module productIds. */
export const WALLETS = [
  // Freighter was renamed Varial; the kit still calls its module "freighter".
  { id: "freighter", name: "Varial", note: "formerly Freighter", icon: "/wallets/varial.svg", url: "https://varialwallet.com" },
  { id: "xbull", name: "xBull", icon: "/wallets/xbull.png", url: "https://xbull.app" },
  { id: "lobstr", name: "Lobstr", icon: "/wallets/lobstr.png", url: "https://lobstr.co" },
  { id: "albedo", name: "Albedo", icon: "/wallets/albedo.png", url: "https://albedo.link" },
  { id: "hana", name: "Hana", icon: "/wallets/hana.png", url: "https://hanawallet.io" },
] as const;

export interface WalletOption {
  id: string;
  name: string;
  /** e.g. "formerly Freighter". */
  note?: string;
  /** Official logo, served from /public/wallets. */
  icon: string;
  url: string;
  /** Null until the kit has checked. */
  available: boolean | null;
}

interface WalletContext {
  address: string | null;
  walletId: string | null;
  walletName: string | null;
  /** The kit has loaded and restored any saved session. */
  ready: boolean;
  /** Id of the wallet being connected, while it is. */
  connecting: string | null;
  /** false: the wallet reports another network. null: it can't tell us. */
  onTestnet: boolean | null;
  /** The passphrase the wallet reported, if any. */
  walletPassphrase: string | null;
  wallets: WalletOption[];
  connectWith: (id: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
  sign: SignFn;
  refreshNetwork: () => Promise<void>;
  /** The design's "Connect a wallet" modal. */
  openConnect: () => void;
  closeConnect: () => void;
  connectOpen: boolean;
  /** The last connection error, in plain words. */
  connectError: string | null;
}

const Ctx = createContext<WalletContext | null>(null);

async function loadKit(): Promise<KitClass> {
  const [kit, freighter, xbull, lobstr, albedo, hana] = await Promise.all([
    import("@creit.tech/stellar-wallets-kit"),
    import("@creit.tech/stellar-wallets-kit/modules/freighter"),
    import("@creit.tech/stellar-wallets-kit/modules/xbull"),
    import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
    import("@creit.tech/stellar-wallets-kit/modules/albedo"),
    import("@creit.tech/stellar-wallets-kit/modules/hana"),
  ]);
  kit.StellarWalletsKit.init({
    modules: [
      new freighter.FreighterModule(),
      new xbull.xBullModule(),
      new lobstr.LobstrModule(),
      new albedo.AlbedoModule(),
      new hana.HanaModule(),
    ],
    // The kit defaults to Mainnet.
    network: kit.Networks.TESTNET,
  });
  return kit.StellarWalletsKit;
}

const nameOf = (id: string | null) => WALLETS.find((w) => w.id === id)?.name ?? null;

function selectedId(K: KitClass): string | null {
  try {
    return K.selectedModule.productId;
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const kit = useRef<KitClass | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [onTestnet, setOnTestnet] = useState<boolean | null>(null);
  const [walletPassphrase, setWalletPassphrase] = useState<string | null>(null);
  const [supported, setSupported] = useState<ISupportedWallet[] | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refreshNetwork = useCallback(async () => {
    if (!kit.current) return;
    try {
      const { networkPassphrase } = await kit.current.getNetwork();
      setWalletPassphrase(networkPassphrase ?? null);
      setOnTestnet(networkPassphrase ? networkPassphrase === config.networkPassphrase : null);
    } catch {
      // Not every wallet reports its network; the signature check still guards.
      setWalletPassphrase(null);
      setOnTestnet(null);
    }
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const [K, { KitEventType }] = await Promise.all([loadKit(), import("@creit.tech/stellar-wallets-kit")]);
        if (cancelled) return;
        kit.current = K;
        unsubscribe = K.on(KitEventType.STATE_UPDATED, (e) => setAddress(e.payload.address ?? null));
        try {
          const { address: saved } = await K.getAddress(); // restored from the kit's localStorage session
          setAddress(saved);
          setWalletId(selectedId(K));
          await refreshNetwork();
        } catch {
          /* nothing connected yet */
        }
        K.refreshSupportedWallets()
          .then((list) => !cancelled && setSupported(list))
          .catch(() => !cancelled && setSupported([]));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [refreshNetwork]);

  // Re-check the wallet's network when the tab regains focus (people switch it in the extension).
  useEffect(() => {
    if (!address) return;
    const onFocus = () => void refreshNetwork();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [address, refreshNetwork]);

  const connectWith = useCallback(
    async (id: string) => {
      const K = kit.current;
      if (!K) return null;
      setConnecting(id);
      setConnectError(null);
      try {
        K.setWallet(id);
        const { address: picked } = await K.fetchAddress();
        setAddress(picked);
        setWalletId(id);
        await refreshNetwork();
        setConnectOpen(false);
        return picked;
      } catch (err) {
        const e = err as { code?: number; message?: string };
        setConnectError(
          e?.code === -4 || /reject|declin|denied|cancel/i.test(e?.message ?? "")
            ? "You declined in your wallet. Nothing was shared."
            : `${nameOf(id) ?? "That wallet"} didn't connect. Is it installed and unlocked?`,
        );
        return null;
      } finally {
        setConnecting(null);
      }
    },
    [refreshNetwork],
  );

  const disconnect = useCallback(async () => {
    try {
      await kit.current?.disconnect();
    } catch {
      /* already gone */
    }
    setAddress(null);
    setWalletId(null);
    setOnTestnet(null);
    setWalletPassphrase(null);
  }, []);

  const sign = useCallback<SignFn>(
    async (txXdr) => {
      if (!kit.current || !address) throw new Error("Connect a wallet first");
      const { signedTxXdr } = await kit.current.signTransaction(txXdr, {
        networkPassphrase: config.networkPassphrase,
        address,
      });
      return signedTxXdr;
    },
    [address],
  );

  const wallets = useMemo<WalletOption[]>(
    () =>
      WALLETS.map((w) => {
        const s = supported?.find((x) => x.id === w.id);
        return { id: w.id, name: w.name, note: "note" in w ? w.note : undefined, icon: w.icon, url: w.url, available: supported ? !!s?.isAvailable : null };
      }),
    [supported],
  );

  const openConnect = useCallback(() => {
    setConnectError(null);
    setConnectOpen(true);
    kit.current
      ?.refreshSupportedWallets()
      .then(setSupported)
      .catch(() => undefined);
  }, []);
  const closeConnect = useCallback(() => setConnectOpen(false), []);

  const value = useMemo<WalletContext>(
    () => ({
      address,
      walletId,
      walletName: nameOf(walletId),
      ready,
      connecting,
      onTestnet,
      walletPassphrase,
      wallets,
      connectWith,
      disconnect,
      sign,
      refreshNetwork,
      openConnect,
      closeConnect,
      connectOpen,
      connectError,
    }),
    [address, walletId, ready, connecting, onTestnet, walletPassphrase, wallets, connectWith, disconnect, sign, refreshNetwork, openConnect, closeConnect, connectOpen, connectError],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <ConnectModal />
    </Ctx.Provider>
  );
}

export function useWallet(): WalletContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
